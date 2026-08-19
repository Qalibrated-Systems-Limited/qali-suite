import { sql } from "drizzle-orm";
import { privilegedDb } from "./provisioning";

/**
 * The platform's view of its tenants.
 *
 * READS ACROSS COMPANIES, WHICH NOTHING ELSE HERE DOES. `companies` is under
 * RLS keyed on its own id (0024), so a scoped connection sees exactly one —
 * which is the point, and why the admin list cannot be built on the ordinary
 * application path. This runs on the privileged connection for the same reason
 * provisioning does.
 *
 * It is the ONE cross-tenant surface, and it is deliberately narrow: names,
 * plans and statuses. No tenant's books are reachable from here. A SuperAdmin
 * who wants to look at a company's ledger enters it, holding a grant, under the
 * same policies as anyone else in it (tenant.ts).
 *
 * Every function here must be called behind a SuperAdmin check. There is no
 * role check in this module because it has no session — the caller has one.
 */

const PER_PAGE = 20;

export interface CompanyListRow {
  /** Postgres tenant id. */
  id: string;
  /** The id the admin routes still carry, from _migration_id_map. */
  sourceId: string | null;
  name: string;
  slug: string;
  code: string | null;
  email: string | null;
  phone: string | null;
  logo: string | null;
  city: string | null;
  country: string | null;
  status: string;
  plan: string;
  subscriptionStatus: string;
  maxUsers: number;
  createdAt: string;
  updatedAt: string;
}

function listRow(r: Record<string, unknown>): CompanyListRow {
  return {
    id: String(r.id),
    sourceId: (r.source_id as string) ?? null,
    name: String(r.name),
    slug: String(r.slug),
    code: (r.code as string) ?? null,
    email: (r.email as string) ?? null,
    phone: (r.phone as string) ?? null,
    logo: (r.logo as string) ?? null,
    city: (r.city as string) ?? null,
    country: (r.country as string) ?? null,
    status: String(r.status),
    plan: String(r.plan),
    subscriptionStatus: String(r.subscription_status),
    maxUsers: Number(r.max_users),
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

/**
 * The tenant list, filtered and paged.
 *
 * ILIKE with an escaped term rather than a regex: the Mongo version built
 * `{ $regex: searchTerm }` straight from the query string, so a user typing
 * `(` got a driver error and one typing `.*` scanned every tenant. Postgres
 * takes the same input as data.
 */
export async function searchCompanies(
  searchTerm = "",
  page = 1,
  filters: { status?: string; plan?: string } = {},
): Promise<CompanyListRow[]> {
  const term = String(searchTerm ?? "").trim();
  const like = term ? `%${term.replace(/[%_\\]/g, "\\$&")}%` : null;
  const status = filters.status && filters.status !== "all" ? filters.status : null;
  const plan = filters.plan && filters.plan !== "all" ? filters.plan : null;
  const offset = (Math.max(1, Number(page) || 1) - 1) * PER_PAGE;

  const rows = (await privilegedDb().execute(sql`
    SELECT c.id, c.name, c.slug, c.code, c.email, c.phone, c.logo,
           c.city, c.country, c.status, c.plan, c.subscription_status,
           c.max_users, c.created_at, c.updated_at,
           m.old_object_id AS source_id
      FROM companies c
      LEFT JOIN _migration_id_map m
        ON m.new_uuid = c.id AND m.collection = 'companies'
     WHERE (${status}::text IS NULL OR c.status = ${status})
       AND (${plan}::text IS NULL OR c.plan = ${plan})
       AND (
         ${like}::text IS NULL
         OR c.name  ILIKE ${like}
         OR c.email ILIKE ${like}
         OR c.slug  ILIKE ${like}
         OR c.city  ILIKE ${like}
       )
     ORDER BY c.created_at DESC
     LIMIT ${PER_PAGE} OFFSET ${offset}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map(listRow);
}

/** How many pages the same filters produce. */
export async function countCompanyPages(
  searchTerm = "",
  filters: { status?: string; plan?: string } = {},
): Promise<number> {
  const term = String(searchTerm ?? "").trim();
  const like = term ? `%${term.replace(/[%_\\]/g, "\\$&")}%` : null;
  const status = filters.status && filters.status !== "all" ? filters.status : null;
  const plan = filters.plan && filters.plan !== "all" ? filters.plan : null;

  const rows = (await privilegedDb().execute(sql`
    SELECT count(*)::int AS n
      FROM companies c
     WHERE (${status}::text IS NULL OR c.status = ${status})
       AND (${plan}::text IS NULL OR c.plan = ${plan})
       AND (
         ${like}::text IS NULL
         OR c.name  ILIKE ${like}
         OR c.email ILIKE ${like}
         OR c.slug  ILIKE ${like}
         OR c.city  ILIKE ${like}
       )
  `)) as unknown as Array<{ n: number }>;

  return Math.max(1, Math.ceil((rows[0]?.n ?? 0) / PER_PAGE));
}

/**
 * One company, whole — record and settings together.
 *
 * Takes EITHER id. The admin routes still carry the Mongo id in their URLs and
 * will for as long as anything links to them, so resolving both here is
 * cheaper than rewriting every href for a rename that changes nothing a user
 * can see.
 */
export async function getCompanyRecord(idOrSourceId: string) {
  const key = String(idOrSourceId ?? "").trim();
  if (!key) return null;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);

  const rows = (await privilegedDb().execute(sql`
    SELECT c.*, m.old_object_id AS source_id,
           to_jsonb(s.*) - 'company_id' AS settings
      FROM companies c
      LEFT JOIN _migration_id_map m
        ON m.new_uuid = c.id AND m.collection = 'companies'
      LEFT JOIN company_settings s ON s.company_id = c.id
     WHERE ${isUuid ? sql`c.id = ${key}::uuid` : sql`m.old_object_id = ${key}`}
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;

  if (!rows.length) return null;
  const r = rows[0];
  const s = (r.settings ?? {}) as Record<string, unknown>;

  const num = (v: unknown, fallback = 0) =>
    v === null || v === undefined ? fallback : Number(v);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

  return {
    id: String(r.id),
    /** The id the admin routes carry. Null for a tenant born in Postgres. */
    sourceId: (r.source_id as string) ?? null,
    /**
     * Transition alias. Sixteen pages and the components under them read
     * `company._id` because this record came from Mongo until 0035, and
     * renaming it in all of them at once would be a large diff that changes
     * nothing a user can see. It is the source id where there is one, so a
     * link built from it still resolves.
     */
    _id: (r.source_id as string) ?? String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    code: (r.code as string) ?? null,
    tagline: (r.tagline as string) ?? null,
    logo: (r.logo as string) ?? null,
    email: (r.email as string) ?? null,
    phone: (r.phone as string) ?? null,
    website: (r.website as string) ?? null,
    address: {
      street: (r.street as string) ?? null,
      city: (r.city as string) ?? null,
      state: (r.state as string) ?? null,
      postalCode: (r.postal_code as string) ?? null,
      country: (r.country as string) ?? null,
    },
    /**
     * Composed, never stored. A joined address that is saved can disagree with
     * the fields it was joined from (§8.4) — Mongo kept a `fullAddress` and a
     * pre-save hook to rebuild it, which is a hook that exists because the
     * value should not have been stored.
     */
    fullAddress: [r.street, r.city, r.state, r.postal_code, r.country]
      .filter(Boolean)
      .join(", "),
    taxPin: (r.tax_pin as string) ?? null,
    vatNumber: (r.vat_number as string) ?? null,
    registrationNumber: (r.registration_number as string) ?? null,
    bankName: (r.bank_name as string) ?? null,
    bankBranch: (r.bank_branch as string) ?? null,
    accountName: (r.account_name as string) ?? null,
    accountNumber: (r.account_number as string) ?? null,
    swiftCode: (r.swift_code as string) ?? null,
    mpesaPaybill: (r.mpesa_paybill as string) ?? null,
    mpesaTill: (r.mpesa_till as string) ?? null,
    baseCurrency: String(r.base_currency),
    status: String(r.status),
    isActive: Boolean(r.is_active),
    subscription: {
      plan: String(r.plan),
      status: String(r.subscription_status),
      trialEndsAt: iso(r.trial_ends_at),
      currentPeriodStart: iso(r.current_period_start),
      currentPeriodEnd: iso(r.current_period_end),
      maxUsers: num(r.max_users, 2),
    },
    conversion: {
      date: r.conversion_date ? String(r.conversion_date) : null,
      setBy: {
        id: (r.conversion_set_by_id as string) ?? null,
        name: (r.conversion_set_by_name as string) ?? null,
      },
      setAt: iso(r.conversion_set_at),
    },
    settings: {
      currency: String(r.base_currency),
      currencySymbol: String(s.currency_symbol ?? "KES"),
      locale: String(s.locale ?? "en-KE"),
      timezone: String(s.timezone ?? "Africa/Nairobi"),
      defaultVatRate: num(s.default_vat_rate, 16),
      enableWithholdingTax: Boolean(s.enable_withholding_tax),
      defaultWhtRate: num(s.default_wht_rate, 5),
      requireGRN: Boolean(s.require_grn),
      fiscalYearStart: num(s.fiscal_year_start_month, 1),
      invoicePrefix: String(s.invoice_prefix ?? "INV"),
      billPrefix: String(s.bill_prefix ?? "BILL"),
      quotePrefix: String(s.quote_prefix ?? "QT"),
      poPrefix: String(s.po_prefix ?? "PO"),
      defaultCostingMethod: String(s.default_costing_method ?? "average"),
      lowStockThreshold: num(s.low_stock_threshold, 10),
      defaultPaymentTerms: String(s.default_payment_terms ?? "Net 30"),
      defaultPaymentTermsDays: num(s.default_payment_terms_days, 30),
      draftInvoiceExpiryDays: num(s.draft_invoice_expiry_days, 14),
      capitalizationThreshold: num(s.capitalization_threshold, 0),
      approvalThresholds: {
        stockAdjustmentValue: num(s.stock_adjustment_value, 50000),
        stockRequestValue: num(s.stock_request_value, 100000),
        stockHighRiskTypes: (s.stock_high_risk_types as string[]) ?? [],
        minimumMarginPercent: num(s.minimum_margin_percent, 8),
        creditNoteValue: num(s.credit_note_value, 25000),
        billPaymentValue: num(s.bill_payment_value, 100000),
        expensePaymentValue: num(s.expense_payment_value, 50000),
        discountCapPercent: num(s.discount_cap_percent, 15),
      },
    },
    features: {
      inventory: Boolean(s.feature_inventory),
      sales: Boolean(s.feature_sales),
      purchases: Boolean(s.feature_purchases),
      accounting: Boolean(s.feature_accounting),
      expenses: Boolean(s.feature_expenses),
      reports: Boolean(s.feature_reports),
      multiCurrency: Boolean(s.feature_multi_currency),
      advancedReporting: Boolean(s.feature_advanced_reporting),
      apiAccess: Boolean(s.feature_api_access),
    },
    createdBy: {
      id: (r.created_by_id as string) ?? null,
      name: (r.created_by_name as string) ?? null,
    },
    lastModifiedBy: {
      id: (r.last_modified_by_id as string) ?? null,
      name: (r.last_modified_by_name as string) ?? null,
    },
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export type CompanyRecord = NonNullable<
  Awaited<ReturnType<typeof getCompanyRecord>>
>;

export interface CompanyStats {
  totalCompanies: number;
  activeCompanies: number;
  inactiveCompanies: number;
  suspendedCompanies: number;
  freeCount: number;
  starterCount: number;
  professionalCount: number;
  enterpriseCount: number;
  trialCount: number;
}

/** Platform counts for the admin header. One pass, not nine queries. */
export async function getCompanyStats(): Promise<CompanyStats> {
  const rows = (await privilegedDb().execute(sql`
    SELECT
      count(*)::int                                              AS total_companies,
      count(*) FILTER (WHERE status = 'active')::int              AS active_companies,
      count(*) FILTER (WHERE status = 'inactive')::int            AS inactive_companies,
      count(*) FILTER (WHERE status = 'suspended')::int           AS suspended_companies,
      count(*) FILTER (WHERE plan = 'free')::int                  AS free_count,
      count(*) FILTER (WHERE plan = 'starter')::int               AS starter_count,
      count(*) FILTER (WHERE plan = 'professional')::int          AS professional_count,
      count(*) FILTER (WHERE plan = 'enterprise')::int            AS enterprise_count,
      count(*) FILTER (WHERE subscription_status = 'trial')::int  AS trial_count
    FROM companies
  `)) as unknown as Array<Record<string, number>>;

  const r = rows[0] ?? {};
  return {
    totalCompanies: Number(r.total_companies ?? 0),
    activeCompanies: Number(r.active_companies ?? 0),
    inactiveCompanies: Number(r.inactive_companies ?? 0),
    suspendedCompanies: Number(r.suspended_companies ?? 0),
    freeCount: Number(r.free_count ?? 0),
    starterCount: Number(r.starter_count ?? 0),
    professionalCount: Number(r.professional_count ?? 0),
    enterpriseCount: Number(r.enterprise_count ?? 0),
    trialCount: Number(r.trial_count ?? 0),
  };
}

/**
 * Every tenant, active or not — name and both ids.
 *
 * Separate from the picker below because they answer different questions: a
 * picker offers companies you may put somebody INTO, and an inactive company
 * is not one of those; a name map has to resolve companies that already have
 * users and documents attached, whatever their status.
 */
export async function listAllCompanies() {
  const rows = (await privilegedDb().execute(sql`
    SELECT c.id, c.name, c.slug, c.status, m.old_object_id AS source_id
      FROM companies c
      LEFT JOIN _migration_id_map m
        ON m.new_uuid = c.id AND m.collection = 'companies'
     ORDER BY c.name
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    sourceId: (r.source_id as string) ?? null,
    _id: (r.source_id as string) ?? String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    status: String(r.status),
  }));
}

/**
 * The conversion (cutover) date, and who set it.
 *
 * The date the business moved onto this system. Opening-balance documents must
 * be dated on or before it, and that check runs against the ledger — so the
 * date belongs next to the ledger rather than one store away from the rule
 * that reads it (0035).
 */
export async function getConversion(sourceCompanyId: string) {
  const record = await getCompanyRecord(String(sourceCompanyId));
  return record?.conversion ?? null;
}

/**
 * Sets the cutover date.
 *
 * Not guarded here against being moved after trading begins — the caller owns
 * that rule and already checks it, because it needs to look at posted entries
 * and opening documents to decide.
 */
export async function setConversionDate(
  sourceCompanyId: string,
  date: Date | string,
  setBy: { id?: string | null; name?: string | null },
) {
  const key = String(sourceCompanyId ?? "").trim();
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error("The conversion date is invalid.");

  const rows = (await privilegedDb().execute(sql`
    WITH target AS (
      SELECT c.id
        FROM companies c
        LEFT JOIN _migration_id_map m
          ON m.new_uuid = c.id AND m.collection = 'companies'
       WHERE ${isUuid ? sql`c.id = ${key}::uuid` : sql`m.old_object_id = ${key}`}
       LIMIT 1
    )
    UPDATE companies c
       SET conversion_date = ${d.toISOString()}::date,
           conversion_set_by_id = ${setBy.id ?? null},
           conversion_set_by_name = ${setBy.name ?? null},
           conversion_set_at = now(),
           updated_at = now()
      FROM target t
     WHERE c.id = t.id
    RETURNING c.id
  `)) as unknown as Array<{ id: string }>;

  if (!rows.length) throw new Error("Company not found");
  return { companyId: rows[0].id };
}

/**
 * A company already using this name or code, if there is one.
 *
 * The uniqueness check for the create and edit forms. It runs in Postgres
 * because that is where the constraint is: `companies_code_uq` is a unique
 * index, so a race past this check still fails at the database rather than
 * producing two companies sharing a document-number prefix.
 *
 * Name is compared case-insensitively, as the Mongo version did — "Acme" and
 * "ACME" on one platform is a support call, not a feature.
 */
export async function findCompanyByNameOrCode(
  name: string | null,
  code: string | null,
  excludeIdOrSourceId?: string | null,
) {
  const n = name ? String(name).trim() : null;
  const c = code ? String(code).trim().toUpperCase() : null;
  if (!n && !c) return null;

  const exclude = excludeIdOrSourceId ? String(excludeIdOrSourceId) : null;
  const excludeIsUuid =
    !!exclude &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(exclude);

  const rows = (await privilegedDb().execute(sql`
    SELECT c.id, c.name, c.code, m.old_object_id AS source_id
      FROM companies c
      LEFT JOIN _migration_id_map m
        ON m.new_uuid = c.id AND m.collection = 'companies'
     WHERE (${n}::text IS NOT NULL AND lower(c.name) = lower(${n}))
        OR (${c}::text IS NOT NULL AND c.code = ${c})
     LIMIT 5
  `)) as unknown as Array<Record<string, unknown>>;

  const hit = rows.find((r) => {
    if (!exclude) return true;
    return excludeIsUuid
      ? String(r.id) !== exclude
      : String(r.source_id ?? "") !== exclude;
  });
  if (!hit) return null;

  return {
    id: String(hit.id),
    sourceId: (hit.source_id as string) ?? null,
    name: String(hit.name),
    code: (hit.code as string) ?? null,
    /** Which field collided, so the caller can put the error on that input. */
    conflict: c && hit.code === c ? ("code" as const) : ("name" as const),
  };
}

/** Whether a tenant exists at all. Cheaper than reading the record to find out. */
export async function companyExists(idOrSourceId: string) {
  return (await getCompanySubscription(String(idOrSourceId))) !== null;
}

/** Active tenants, for a picker. Name and both ids, nothing else. */
export async function listCompaniesForDropdown() {
  const rows = (await privilegedDb().execute(sql`
    SELECT c.id, c.name, c.slug, m.old_object_id AS source_id
      FROM companies c
      LEFT JOIN _migration_id_map m
        ON m.new_uuid = c.id AND m.collection = 'companies'
     WHERE c.status = 'active'
     ORDER BY c.name
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    sourceId: (r.source_id as string) ?? null,
    /**
     * Transition alias, as on getCompanyRecord. A user is still assigned to a
     * company by its Mongo id — that is what User.companyId holds — so a
     * picker that wrote the tenant uuid instead would assign them to a company
     * nothing else can find.
     */
    _id: (r.source_id as string) ?? String(r.id),
    name: String(r.name),
    slug: String(r.slug),
  }));
}

/**
 * The subscription, in the shape the plan gate and the seat check already read.
 *
 * Nested under `subscription` deliberately: `evaluateUserLimit` and the gate
 * were written against the Mongo document, they are pure functions of that
 * shape, and changing the shape would mean re-testing the expiry rules rather
 * than moving the storage.
 *
 * Keyed on the source id because that is what the session carries.
 */
export async function getCompanySubscription(sourceCompanyId: string) {
  const key = String(sourceCompanyId ?? "").trim();
  if (!key) return null;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);

  const rows = (await privilegedDb().execute(sql`
    SELECT c.id, c.code, c.name, c.status, c.plan, c.subscription_status,
           c.trial_ends_at, c.current_period_start, c.current_period_end,
           c.max_users, m.old_object_id AS source_id
      FROM companies c
      LEFT JOIN _migration_id_map m
        ON m.new_uuid = c.id AND m.collection = 'companies'
     WHERE ${isUuid ? sql`c.id = ${key}::uuid` : sql`m.old_object_id = ${key}`}
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;

  if (!rows.length) return null;
  return shapeSubscription(rows[0]);
}

function shapeSubscription(r: Record<string, unknown>) {
  return {
    companyId: String(r.id),
    sourceId: (r.source_id as string) ?? null,
    _id: (r.source_id as string) ?? String(r.id),
    code: (r.code as string) ?? null,
    name: r.name ? String(r.name) : null,
    companyStatus: String(r.status),
    subscription: {
      plan: String(r.plan),
      status: String(r.subscription_status),
      trialEndsAt: r.trial_ends_at ? new Date(r.trial_ends_at as string) : null,
      currentPeriodStart: r.current_period_start
        ? new Date(r.current_period_start as string)
        : null,
      currentPeriodEnd: r.current_period_end
        ? new Date(r.current_period_end as string)
        : null,
      maxUsers: Number(r.max_users),
    },
  };
}

/**
 * Changes a subscription and says what it was.
 *
 * ONE STATEMENT. The Mongo version peeked at the plan, wrote with
 * findByIdAndUpdate, then read back — three round trips, with the "previous"
 * snapshot taken from a different read than the one that wrote. Two admins
 * changing a plan at once could each log the other's state as their own
 * "before". The CTE reads the row and updates it in the same statement, so the
 * snapshot is the one that was actually replaced.
 *
 * Only the keys supplied are changed; the rest are left alone.
 */
export async function updateCompanySubscription(
  sourceCompanyId: string,
  updates: {
    plan?: string;
    status?: string;
    maxUsers?: number;
    trialEndsAt?: Date | string | null;
    currentPeriodStart?: Date | string | null;
    currentPeriodEnd?: Date | string | null;
  },
) {
  const key = String(sourceCompanyId ?? "").trim();
  if (!key) throw new Error("updateCompanySubscription requires a company id");

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);

  // undefined means "leave it"; null is a real value for the date columns, so
  // they carry a separate "did the caller mention this" flag.
  const iso = (v: Date | string | null | undefined) =>
    v === undefined || v === null
      ? null
      : (v instanceof Date ? v : new Date(v)).toISOString();

  const rows = (await privilegedDb().execute(sql`
    WITH target AS (
      SELECT c.id
        FROM companies c
        LEFT JOIN _migration_id_map m
          ON m.new_uuid = c.id AND m.collection = 'companies'
       WHERE ${isUuid ? sql`c.id = ${key}::uuid` : sql`m.old_object_id = ${key}`}
       LIMIT 1
    ),
    before AS (
      SELECT c.* FROM companies c JOIN target t ON t.id = c.id
    ),
    upd AS (
      UPDATE companies c
         SET plan = COALESCE(${updates.plan ?? null}, c.plan),
             subscription_status = COALESCE(${updates.status ?? null}, c.subscription_status),
             max_users = COALESCE(${updates.maxUsers ?? null}::int, c.max_users),
             trial_ends_at = CASE WHEN ${updates.trialEndsAt !== undefined}
               THEN ${iso(updates.trialEndsAt)}::timestamptz ELSE c.trial_ends_at END,
             current_period_start = CASE WHEN ${updates.currentPeriodStart !== undefined}
               THEN ${iso(updates.currentPeriodStart)}::timestamptz ELSE c.current_period_start END,
             current_period_end = CASE WHEN ${updates.currentPeriodEnd !== undefined}
               THEN ${iso(updates.currentPeriodEnd)}::timestamptz ELSE c.current_period_end END,
             updated_at = now()
        FROM target t
       WHERE c.id = t.id
      RETURNING c.*
    )
    SELECT to_jsonb(b.*) AS before_row, to_jsonb(u.*) AS after_row,
           m.old_object_id AS source_id
      FROM before b, upd u
      LEFT JOIN _migration_id_map m
        ON m.new_uuid = u.id AND m.collection = 'companies'
  `)) as unknown as Array<Record<string, unknown>>;

  if (!rows.length) throw new Error("Company not found");

  const b = rows[0].before_row as Record<string, unknown>;
  const a = rows[0].after_row as Record<string, unknown>;
  const sourceId = (rows[0].source_id as string) ?? null;

  return {
    previous: shapeSubscription({ ...b, source_id: sourceId }).subscription,
    updated: shapeSubscription({ ...a, source_id: sourceId }),
  };
}

/**
 * The letterhead: what a document has to print.
 *
 * The same record, named for the one job it does on an invoice or a statement.
 * Kept as its own entry point so a page that only needs a letterhead does not
 * read as though it is doing company administration.
 */
export async function getCompanyForDocuments(idOrSourceId: string) {
  return getCompanyRecord(idOrSourceId);
}

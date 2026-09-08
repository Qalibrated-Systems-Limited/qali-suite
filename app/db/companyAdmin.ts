import { sql } from "drizzle-orm";
import { privilegedDb } from "./provisioning";
import { pgArray } from "./pgArray";

/**
 * Company lifecycle on the Postgres side.
 *
 * A tenant exists in two stores while the migration runs, and the operations
 * that change a company as a WHOLE — rename it, deactivate it, reset its books
 * — have to reach both or the two drift. Provisioning covered creation; this
 * covers the rest of the lifecycle.
 *
 * Runs on the privileged connection for the same reason provisioning does:
 * since 0024 `companies` is under RLS keyed on its own id, so the row can only
 * be reached from inside its own scope, and a reset spans every tenant table.
 */

/**
 * The tenant's Postgres uuid, from either id form.
 *
 * IT ONLY READ THE MAP, and that silently broke the caller. `syncCompanyRecord`
 * returns `{ synced: false }` when this is null — no error, nothing written —
 * so passing it the TENANT UUID, which is what the session carries since the
 * auth cutover and what `provisionCompany` returns, dropped the entire company
 * form on the floor: branding, tax, bank and settings all discarded while the
 * form said it had saved. Caught by a test asserting a `code` came back.
 *
 * A live uuid resolves to itself; anything else is looked up in the map, which
 * is the same order `resolveCompanyUuid` and `getCompanyRecord` use.
 */
async function companyUuidFor(sourceCompanyId: string) {
  const key = String(sourceCompanyId ?? "").trim();
  if (!key) return null;

  const looksUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);

  if (looksUuid) {
    const live = (await privilegedDb().execute(sql`
      SELECT id FROM companies WHERE id = ${key}::uuid
    `)) as unknown as Array<{ id: string }>;
    if (live.length) return live[0].id;
  }

  const rows = (await privilegedDb().execute(sql`
    SELECT new_uuid FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${key}
  `)) as unknown as Array<{ new_uuid: string }>;
  return rows.length ? rows[0].new_uuid : null;
}

/**
 * Writes the whole company record to Postgres.
 *
 * It used to carry name, slug and base currency only, on the reasoning that
 * `companies` was a tenant root rather than a copy of the company document.
 * 0035 ended that: the settings the books OBEY are here now, because a rule
 * read from another store is a rule outside the transaction that has to honour
 * it. So this mirrors everything while both stores are live, and Mongo becomes
 * the follower rather than the source.
 *
 * Takes the Mongo document's own shape — nested `settings`, `subscription`,
 * `address` — so the caller hands over what it already has instead of
 * flattening it correctly at every call site.
 *
 * A no-op for a company that was never provisioned: it picks these up when it
 * is, from the same source.
 */
export interface CompanyRecordChanges {
  name?: string | null;
  slug?: string | null;
  code?: string | null;
  tagline?: string | null;
  logo?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
  taxPin?: string | null;
  vatNumber?: string | null;
  registrationNumber?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  swiftCode?: string | null;
  mpesaPaybill?: string | null;
  mpesaTill?: string | null;
  status?: string | null;
  subscription?: {
    plan?: string | null;
    status?: string | null;
    trialEndsAt?: Date | string | null;
    currentPeriodStart?: Date | string | null;
    currentPeriodEnd?: Date | string | null;
    maxUsers?: number | null;
  } | null;
  conversion?: {
    date?: Date | string | null;
    setBy?: { id?: string | null; name?: string | null } | null;
    setAt?: Date | string | null;
  } | null;
  lastModifiedBy?: { id?: string | null; name?: string | null } | null;
  /** Mongo's nested settings block; only the keys present are written. */
  settings?: Record<string, unknown> | null;
  /** Mongo's feature flags. */
  features?: Record<string, boolean> | null;
  /** Legacy alias — callers that only had the currency. */
  baseCurrency?: string | null;
}

/** null for anything the caller did not supply, so COALESCE leaves it alone. */
function opt(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function optNum(value: unknown): number | null {
  return value === undefined || value === null || value === "" ? null : Number(value);
}

function optBool(value: unknown): boolean | null {
  return value === undefined || value === null ? null : Boolean(value);
}

function optDate(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function syncCompanyRecord(
  sourceCompanyId: string,
  changes: CompanyRecordChanges,
) {
  const companyId = await companyUuidFor(sourceCompanyId);
  if (!companyId) return { synced: false as const };

  const s = (changes.settings ?? {}) as Record<string, unknown>;
  const thresholds = (s.approvalThresholds ?? {}) as Record<string, unknown>;
  const sub = changes.subscription ?? {};
  const addr = changes.address ?? {};
  const conv = changes.conversion ?? {};
  const feat = changes.features ?? {};

  // Mongo's status is the three-valued one; is_active is GENERATED from it.
  const status = opt(changes.status);
  const currency = opt(s.currency) ?? opt(changes.baseCurrency);

  await privilegedDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);

    await tx.execute(sql`
      UPDATE companies
         SET name                 = COALESCE(${opt(changes.name)}, name),
             slug                 = COALESCE(${opt(changes.slug)}, slug),
             code                 = COALESCE(${opt(changes.code)?.toUpperCase() ?? null}, code),
             tagline              = COALESCE(${opt(changes.tagline)}, tagline),
             logo                 = COALESCE(${opt(changes.logo)}, logo),
             email                = COALESCE(${opt(changes.email)?.toLowerCase() ?? null}, email),
             phone                = COALESCE(${opt(changes.phone)}, phone),
             website              = COALESCE(${opt(changes.website)}, website),
             street               = COALESCE(${opt(addr.street)}, street),
             city                 = COALESCE(${opt(addr.city)}, city),
             state                = COALESCE(${opt(addr.state)}, state),
             postal_code          = COALESCE(${opt(addr.postalCode)}, postal_code),
             country              = COALESCE(${opt(addr.country)}, country),
             tax_pin              = COALESCE(${opt(changes.taxPin)?.toUpperCase() ?? null}, tax_pin),
             vat_number           = COALESCE(${opt(changes.vatNumber)}, vat_number),
             registration_number  = COALESCE(${opt(changes.registrationNumber)}, registration_number),
             bank_name            = COALESCE(${opt(changes.bankName)}, bank_name),
             bank_branch          = COALESCE(${opt(changes.bankBranch)}, bank_branch),
             account_name         = COALESCE(${opt(changes.accountName)}, account_name),
             account_number       = COALESCE(${opt(changes.accountNumber)}, account_number),
             swift_code           = COALESCE(${opt(changes.swiftCode)}, swift_code),
             mpesa_paybill        = COALESCE(${opt(changes.mpesaPaybill)}, mpesa_paybill),
             mpesa_till           = COALESCE(${opt(changes.mpesaTill)}, mpesa_till),
             base_currency        = COALESCE(${currency?.toUpperCase() ?? null}, base_currency),
             status               = COALESCE(${status}, status),
             plan                 = COALESCE(${opt(sub.plan)}, plan),
             subscription_status  = COALESCE(${opt(sub.status)}, subscription_status),
             trial_ends_at        = COALESCE(${optDate(sub.trialEndsAt)}::timestamptz, trial_ends_at),
             current_period_start = COALESCE(${optDate(sub.currentPeriodStart)}::timestamptz, current_period_start),
             current_period_end   = COALESCE(${optDate(sub.currentPeriodEnd)}::timestamptz, current_period_end),
             max_users            = COALESCE(${optNum(sub.maxUsers)}::int, max_users),
             conversion_date      = COALESCE(${optDate(conv.date)}::date, conversion_date),
             conversion_set_by_id = COALESCE(${opt(conv.setBy?.id)}, conversion_set_by_id),
             conversion_set_by_name = COALESCE(${opt(conv.setBy?.name)}, conversion_set_by_name),
             conversion_set_at    = COALESCE(${optDate(conv.setAt)}::timestamptz, conversion_set_at),
             last_modified_by_id  = COALESCE(${opt(changes.lastModifiedBy?.id)}, last_modified_by_id),
             last_modified_by_name = COALESCE(${opt(changes.lastModifiedBy?.name)}, last_modified_by_name),
             updated_at           = now()
       WHERE id = ${companyId}
    `);

    // The settings row exists from provisioning; upserted anyway so a tenant
    // that predates 0035 and somehow missed the backfill still lands one.
    await tx.execute(sql`
      INSERT INTO company_settings (company_id) VALUES (${companyId})
      ON CONFLICT (company_id) DO NOTHING
    `);

    await tx.execute(sql`
      UPDATE company_settings
         SET currency_symbol      = COALESCE(${opt(s.currencySymbol)}, currency_symbol),
             locale               = COALESCE(${opt(s.locale)}, locale),
             timezone             = COALESCE(${opt(s.timezone)}, timezone),
             default_vat_rate     = COALESCE(${optNum(s.defaultVatRate)}::numeric, default_vat_rate),
             enable_withholding_tax = COALESCE(${optBool(s.enableWithholdingTax)}::boolean, enable_withholding_tax),
             default_wht_rate     = COALESCE(${optNum(s.defaultWhtRate)}::numeric, default_wht_rate),
             require_grn          = COALESCE(${optBool(s.requireGRN)}::boolean, require_grn),
             fiscal_year_start_month = COALESCE(${optNum(s.fiscalYearStart)}::int, fiscal_year_start_month),
             invoice_prefix       = COALESCE(${opt(s.invoicePrefix)}, invoice_prefix),
             bill_prefix          = COALESCE(${opt(s.billPrefix)}, bill_prefix),
             quote_prefix         = COALESCE(${opt(s.quotePrefix)}, quote_prefix),
             po_prefix            = COALESCE(${opt(s.poPrefix)}, po_prefix),
             default_costing_method = COALESCE(${opt(s.defaultCostingMethod)}, default_costing_method),
             low_stock_threshold  = COALESCE(${optNum(s.lowStockThreshold)}::numeric, low_stock_threshold),
             default_payment_terms = COALESCE(${opt(s.defaultPaymentTerms)}, default_payment_terms),
             default_payment_terms_days = COALESCE(${optNum(s.defaultPaymentTermsDays)}::int, default_payment_terms_days),
             draft_invoice_expiry_days = COALESCE(${optNum(s.draftInvoiceExpiryDays)}::int, draft_invoice_expiry_days),
             capitalization_threshold = COALESCE(${optNum(s.capitalizationThreshold)}::numeric, capitalization_threshold),
             stock_adjustment_value = COALESCE(${optNum(thresholds.stockAdjustmentValue)}::numeric, stock_adjustment_value),
             stock_request_value  = COALESCE(${optNum(thresholds.stockRequestValue)}::numeric, stock_request_value),
             stock_high_risk_types = COALESCE(${pgArray(
               thresholds.stockHighRiskTypes as string[] | undefined,
             )}::text[], stock_high_risk_types),
             minimum_margin_percent = COALESCE(${optNum(thresholds.minimumMarginPercent)}::numeric, minimum_margin_percent),
             credit_note_value    = COALESCE(${optNum(thresholds.creditNoteValue)}::numeric, credit_note_value),
             bill_payment_value   = COALESCE(${optNum(thresholds.billPaymentValue)}::numeric, bill_payment_value),
             expense_payment_value = COALESCE(${optNum(thresholds.expensePaymentValue)}::numeric, expense_payment_value),
             discount_cap_percent = COALESCE(${optNum(thresholds.discountCapPercent)}::numeric, discount_cap_percent),
             feature_inventory    = COALESCE(${optBool(feat.inventory)}::boolean, feature_inventory),
             feature_sales        = COALESCE(${optBool(feat.sales)}::boolean, feature_sales),
             feature_purchases    = COALESCE(${optBool(feat.purchases)}::boolean, feature_purchases),
             feature_accounting   = COALESCE(${optBool(feat.accounting)}::boolean, feature_accounting),
             feature_expenses     = COALESCE(${optBool(feat.expenses)}::boolean, feature_expenses),
             feature_reports      = COALESCE(${optBool(feat.reports)}::boolean, feature_reports),
             feature_multi_currency = COALESCE(${optBool(feat.multiCurrency)}::boolean, feature_multi_currency),
             feature_advanced_reporting = COALESCE(${optBool(feat.advancedReporting)}::boolean, feature_advanced_reporting),
             feature_api_access   = COALESCE(${optBool(feat.apiAccess)}::boolean, feature_api_access),
             updated_at           = now()
       WHERE company_id = ${companyId}
    `);
  });

  return { synced: true as const, companyId };
}

/**
 * Activates or deactivates the tenant.
 *
 * `is_active` is not decorative: withAuthorizedTenant refuses a deactivated
 * tenant, so deactivating a company here actually stops its books being read
 * or written rather than only greying it out in an admin list.
 */
export async function setCompanyActive(
  sourceCompanyId: string,
  isActive: boolean,
  /**
   * Which inactive state. Mongo distinguishes "inactive" from "suspended" and
   * the books do not care, but an admin list that shows every stopped company
   * as merely "inactive" cannot tell a lapsed trial from a deliberate
   * suspension.
   */
  inactiveStatus: "inactive" | "suspended" = "inactive",
) {
  const companyId = await companyUuidFor(sourceCompanyId);
  if (!companyId) return { synced: false as const };

  await privilegedDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
    // `status`, not `is_active`: since 0035 is_active is GENERATED from it and
    // cannot be written, which is what stops the two disagreeing.
    await tx.execute(sql`
      UPDATE companies
         SET status = ${isActive ? "active" : inactiveStatus}, updated_at = now()
       WHERE id = ${companyId}
    `);
  });

  // No cache to invalidate: the tenant gate reads is_active through the
  // grant list on every request, so a deactivation takes effect immediately.
  return { synced: true as const, companyId };
}

/**
 * Master data that survives a reset — the Postgres half of
 * RESET_KEEP_COLLECTIONS in lib/company-reset.js, and it has to agree with it.
 * A table kept on one side and wiped on the other leaves the two stores
 * describing different businesses.
 */
const KEEP = new Set([
  "companies",
  "accounts", // chart of accounts; balances are derived, so nothing to zero
  "fiscal_periods",
  "parties", // wiped only with wipeParties
  "products", // catalogue kept, quantities zeroed
  /*
   * A KPI DEFINITION IS CONFIGURATION; ITS ACTUALS ARE NOT. `kpi_snapshots`
   * is deliberately absent — the numbers go with the rest of the
   * transactional data, and the targets, owners and thresholds somebody sat
   * down and agreed survive, which is what `kpis` in RESET_KEEP_COLLECTIONS
   * has always meant on the Mongo side. This table is discovery-driven, so
   * without this line 0097's new tables would have been wiped on one side
   * and kept on the other from the moment they existed.
   */
  "kpis",
]);

/**
 * Back-references that make the delete order a cycle rather than an order.
 *
 * The same three the backfill's ORDER note records, pointing the other way:
 * stock_requests -> invoices -> item_checkouts -> stock_requests, and
 * bill_lines -> weighbridge_tickets -> bills. Nulled first so what remains is
 * a DAG the pass below can drain.
 */
const CYCLE_EDGES: Array<[string, string[]]> = [
  ["stock_requests", ["draft_invoice_id"]],
  ["item_checkouts", ["sale_invoice_id", "failed_invoice_id"]],
  ["weighbridge_tickets", ["invoice_id", "bill_id", "linked_ticket_id"]],
];

export interface ResetOptions {
  /** Count only. Nothing is deleted. */
  dryRun?: boolean;
  /** Also wipe customers, suppliers and employees. */
  wipeParties?: boolean;
}

/**
 * Deletes a tenant's transactional data, keeping its master data.
 *
 * DISCOVERY-DRIVEN, like the Mongo engine it mirrors: the tables come from
 * information_schema rather than a hand-written list, so a table added by a
 * later slice is covered without anyone remembering to add it here. That was
 * the lesson of the hand-listed script this replaces on the other side.
 *
 * ORDERING IS DRAINED, NOT DECLARED. After the cycle edges are nulled, each
 * pass attempts every remaining table inside a savepoint and defers the ones
 * whose children have not gone yet. It repeats until a pass makes no progress.
 * If tables remain at that point it RAISES with their names — a new cycle
 * surfaces loudly rather than silently leaving a tenant's data behind on an
 * operation whose whole promise is that it is gone.
 *
 * NEVER TRUNCATE. It ignores row-level security entirely (§9A.1), so it would
 * be a cross-tenant delete rather than a reset. Every statement here is
 * scoped by company_id and runs inside the tenant's own RLS scope, so a policy
 * bug fails closed instead of reaching another tenant's books.
 */
export async function resetCompanyBooks(
  sourceCompanyId: string,
  opts: ResetOptions = {},
) {
  const { dryRun = false, wipeParties = false } = opts;
  const companyId = await companyUuidFor(sourceCompanyId);
  if (!companyId) return { synced: false as const, summary: {}, totalDeleted: 0 };

  const keep = new Set(KEEP);
  if (wipeParties) keep.delete("parties");

  const db = privilegedDb();
  const summary: Record<string, number> = {};

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);

    const discovered = (await tx.execute(sql`
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public'
         AND c.column_name = 'company_id'
         AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name
    `)) as unknown as Array<{ table_name: string }>;

    let pending = discovered
      .map((r) => r.table_name)
      .filter((name) => !keep.has(name));

    if (dryRun) {
      for (const name of pending) {
        const [row] = (await tx.execute(
          sql`SELECT count(*)::int AS n FROM ${sql.identifier(name)} WHERE company_id = ${companyId}`,
        )) as unknown as Array<{ n: number }>;
        if (row.n) summary[name] = row.n;
      }
      // Nothing was written, but the transaction is rolled back regardless so
      // a dry run cannot leave a scoped connection in a surprising state.
      throw new DryRun();
    }

    for (const [table, columns] of CYCLE_EDGES) {
      if (keep.has(table) || !pending.includes(table)) continue;
      for (const column of columns) {
        await tx.execute(sql`
          UPDATE ${sql.identifier(table)}
             SET ${sql.identifier(column)} = NULL
           WHERE company_id = ${companyId}
             AND ${sql.identifier(column)} IS NOT NULL
        `);
      }
    }

    while (pending.length) {
      const deferred: string[] = [];
      let progressed = false;

      for (const name of pending) {
        try {
          const deleted = (await tx.transaction(async (sp) => {
            const rows = (await sp.execute(sql`
              DELETE FROM ${sql.identifier(name)} WHERE company_id = ${companyId}
              RETURNING 1
            `)) as unknown as Array<unknown>;
            return rows.length;
          })) as number;

          if (deleted) summary[name] = (summary[name] ?? 0) + deleted;
          progressed = true;
        } catch {
          // A child still holds a reference. Try again once it has gone.
          deferred.push(name);
        }
      }

      if (!progressed) {
        throw new Error(
          "Reset could not drain these tables — a reference cycle is not covered " +
            `by CYCLE_EDGES: ${deferred.join(", ")}`,
        );
      }
      pending = deferred;
    }

    // Quantities are stored on products, not derived, so they are zeroed the
    // way the Mongo engine zeroes them. Account balances need no equivalent:
    // they are a view over journal_lines, which have just gone (§4.4).
    await tx.execute(sql`
      UPDATE products
         SET quantity_on_hand = 0, quantity_committed = 0, quantity_on_hold = 0,
             updated_at = now()
       WHERE company_id = ${companyId}
    `);
  }).catch((err) => {
    if (err instanceof DryRun) return;
    throw err;
  });

  const totalDeleted = Object.values(summary).reduce((a, b) => a + b, 0);
  return { synced: true as const, companyId, summary, totalDeleted };
}

/** Rolls a dry run back without reporting it as a failure. */
class DryRun extends Error {}

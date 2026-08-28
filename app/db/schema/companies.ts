import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  date,
  numeric,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * The company record (0035).
 *
 * Tenant root AND company master. It was only the root while the ledger was
 * the only thing here; once the books moved, the settings the books obey had
 * to move with them — a rule read from another store is a rule outside the
 * transaction that has to honour it.
 *
 * The one table not scoped by a company_id: its RLS policy (0024) keys on its
 * own `id`, plus a second policy for the companies a user holds a grant for
 * (0034).
 *
 * `isActive` is GENERATED from `status` and cannot be written. Mongo carries a
 * three-valued status and this carried a two-valued flag; keeping both writable
 * would let a company be suspended in the admin list while its books stayed
 * open, which is the exact failure the flag was added to stop.
 */
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    /** Short token used in document numbers. Unique platform-wide, not per tenant. */
    code: text("code"),
    tagline: text("tagline"),
    logo: text("logo"),

    email: text("email"),
    phone: text("phone"),
    website: text("website"),

    street: text("street"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("Kenya"),

    taxPin: text("tax_pin"),
    vatNumber: text("vat_number"),
    registrationNumber: text("registration_number"),

    bankName: text("bank_name"),
    bankBranch: text("bank_branch"),
    accountName: text("account_name"),
    accountNumber: text("account_number"),
    swiftCode: text("swift_code"),
    mpesaPaybill: text("mpesa_paybill"),
    mpesaTill: text("mpesa_till"),

    baseCurrency: text("base_currency").notNull().default("KES"),

    plan: text("plan").notNull().default("free"),
    subscriptionStatus: text("subscription_status").notNull().default("trial"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    /** -1 is unlimited, the sentinel lib/plans.js already speaks. */
    maxUsers: integer("max_users").notNull().default(2),

    /** Cutover date. Opening balances must be dated on or before it. */
    conversionDate: date("conversion_date"),
    conversionSetById: text("conversion_set_by_id"),
    conversionSetByName: text("conversion_set_by_name"),
    conversionSetAt: timestamp("conversion_set_at", { withTimezone: true }),

    status: text("status").notNull().default("active"),
    /** GENERATED from status — read only. */
    isActive: boolean("is_active").notNull(),

    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    lastModifiedById: text("last_modified_by_id"),
    lastModifiedByName: text("last_modified_by_name"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("companies_code_uq").on(t.code).where(sql`${t.code} IS NOT NULL`),
    index("companies_status_idx").on(t.status),
    index("companies_subscription_status_idx").on(t.subscriptionStatus),
    check(
      "companies_status_valid",
      sql`${t.status} IN ('active', 'inactive', 'suspended')`,
    ),
    check(
      "companies_plan_valid",
      sql`${t.plan} IN ('free', 'starter', 'professional', 'enterprise')`,
    ),
    check(
      "companies_subscription_status_valid",
      sql`${t.subscriptionStatus} IN ('active', 'trial', 'expired', 'cancelled')`,
    ),
    check("companies_max_users_valid", sql`${t.maxUsers} = -1 OR ${t.maxUsers} >= 0`),
  ],
);

/**
 * What the books obey (0035).
 *
 * One row per company, created with it. Separate from `companies` because
 * these are read on ledger paths inside the transaction that acts on them,
 * and a rule read has no business carrying a logo along with it.
 *
 * The document PREFIXES are here; the counters are not. Numbering is
 * `entry_counters` + `next_entry_number()` (0001), which is race-free — the
 * Mongo version read the document, incremented and saved, which is the race
 * that function replaced.
 */
export const companySettings = pgTable(
  "company_settings",
  {
    companyId: uuid("company_id")
      .primaryKey()
      .references(() => companies.id, { onDelete: "cascade" }),

    currencySymbol: text("currency_symbol").notNull().default("KES"),
    locale: text("locale").notNull().default("en-KE"),
    timezone: text("timezone").notNull().default("Africa/Nairobi"),

    defaultVatRate: numeric("default_vat_rate", { precision: 9, scale: 4 })
      .notNull()
      .default("16"),
    enableWithholdingTax: boolean("enable_withholding_tax").notNull().default(true),
    defaultWhtRate: numeric("default_wht_rate", { precision: 9, scale: 4 })
      .notNull()
      .default("5"),

    /** Bill approval posts to GR/IR instead of inventory; an accepted GRN admits stock. */
    requireGrn: boolean("require_grn").notNull().default(false),

    fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),

    invoicePrefix: text("invoice_prefix").notNull().default("INV"),
    billPrefix: text("bill_prefix").notNull().default("BILL"),
    quotePrefix: text("quote_prefix").notNull().default("QT"),
    poPrefix: text("po_prefix").notNull().default("PO"),
    // 0050 and 0051 added these in raw SQL and never came back to the
    // schema, so `drizzle-kit generate` wanted to drop them. 0052 adds
    // claim_prefix and closes the drift in the same pass.
    grnPrefix: text("grn_prefix").notNull().default("GRN"),
    ncrPrefix: text("ncr_prefix").notNull().default("NCR"),
    claimPrefix: text("claim_prefix").notNull().default("CLAIM"),
    assetPrefix: text("asset_prefix").notNull().default("AST"),

    defaultCostingMethod: text("default_costing_method").notNull().default("average"),
    lowStockThreshold: numeric("low_stock_threshold", { precision: 18, scale: 4 })
      .notNull()
      .default("10"),

    defaultPaymentTerms: text("default_payment_terms").notNull().default("Net 30"),
    defaultPaymentTermsDays: integer("default_payment_terms_days")
      .notNull()
      .default(30),

    draftInvoiceExpiryDays: integer("draft_invoice_expiry_days").notNull().default(14),
    capitalizationThreshold: numeric("capitalization_threshold", {
      precision: 18,
      scale: 2,
    })
      .notNull()
      .default("0"),

    // Thresholds are numeric(18,2) like the money they are compared against —
    // comparing a money value to a float is how a 50,000.00 adjustment slips
    // past a 50,000 threshold.
    stockAdjustmentValue: numeric("stock_adjustment_value", { precision: 18, scale: 2 })
      .notNull()
      .default("50000"),
    stockRequestValue: numeric("stock_request_value", { precision: 18, scale: 2 })
      .notNull()
      .default("100000"),
    stockHighRiskTypes: text("stock_high_risk_types")
      .array()
      .notNull()
      .default(sql`ARRAY['theft','write_off','expiry']`),
    minimumMarginPercent: numeric("minimum_margin_percent", { precision: 9, scale: 4 })
      .notNull()
      .default("8"),
    creditNoteValue: numeric("credit_note_value", { precision: 18, scale: 2 })
      .notNull()
      .default("25000"),
    billPaymentValue: numeric("bill_payment_value", { precision: 18, scale: 2 })
      .notNull()
      .default("100000"),
    expensePaymentValue: numeric("expense_payment_value", { precision: 18, scale: 2 })
      .notNull()
      .default("50000"),
    discountCapPercent: numeric("discount_cap_percent", { precision: 9, scale: 4 })
      .notNull()
      .default("15"),

    featureInventory: boolean("feature_inventory").notNull().default(true),
    featureSales: boolean("feature_sales").notNull().default(true),
    featurePurchases: boolean("feature_purchases").notNull().default(true),
    featureAccounting: boolean("feature_accounting").notNull().default(true),
    featureExpenses: boolean("feature_expenses").notNull().default(true),
    featureReports: boolean("feature_reports").notNull().default(true),
    featureMultiCurrency: boolean("feature_multi_currency").notNull().default(false),
    featureAdvancedReporting: boolean("feature_advanced_reporting")
      .notNull()
      .default(false),
    featureApiAccess: boolean("feature_api_access").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "company_settings_fiscal_month_valid",
      sql`${t.fiscalYearStartMonth} BETWEEN 1 AND 12`,
    ),
    /** One method (0067) — see the note on `costingMethodEnum`. */
    check(
      "company_settings_costing_valid",
      sql`${t.defaultCostingMethod} = 'average'`,
    ),
    check(
      "company_settings_draft_expiry_valid",
      sql`${t.draftInvoiceExpiryDays} BETWEEN 1 AND 90`,
    ),
    check(
      "company_settings_margin_valid",
      sql`${t.minimumMarginPercent} BETWEEN 0 AND 100`,
    ),
    check(
      "company_settings_discount_valid",
      sql`${t.discountCapPercent} BETWEEN 0 AND 100`,
    ),
  ],
);

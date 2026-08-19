-- ============================================================================
-- 0035 — The company record moves to Postgres.
--
-- Until now `companies` held four columns — name, slug, base currency, active —
-- and was described as "a tenant root, not a copy of the company document".
-- That was right while the ledger was the only thing here. It stopped being
-- right once the books moved: the settings the books OBEY were still in Mongo,
-- one network away from the transaction that had to honour them.
--
-- It was already costing correctness. `settings.invoicePrefix` let a tenant
-- choose their numbering, and the ported repository numbers invoices with a
-- hardcoded 'INV' — so a tenant who configured a prefix silently stopped
-- getting it. The setting existed, the UI wrote it, and nothing read it.
--
-- SAP keeps the company code and its configuration in the same database as the
-- ledger; NetSuite keeps the subsidiary record there; Odoo keeps res.company
-- there. None of them split a company across two stores, because every rule
-- the books obey is a read that has to be in the transaction.
--
-- TWO TABLES, NOT ONE.
--
--   companies         what the company IS — identity, address, tax, bank,
--                     subscription, status. Read by documents, by the admin
--                     surface, and by the platform.
--   company_settings  what the books OBEY — tax rates, prefixes, costing,
--                     approval thresholds, feature flags. Read on ledger
--                     paths, inside the transaction that acts on them.
--
-- They change on different cadences and are read by different code, and a
-- settings read has no business dragging a logo along with it.
--
-- WHAT IS DELIBERATELY NOT CARRIED OVER:
--
--   fullAddress          A join of the address fields. §8.4 — a stored value
--                        that is a function of other data can disagree with
--                        them. Composed on read instead.
--   invoiceNextNumber    Numbering already lives in `entry_counters` and
--   billNextNumber       `next_entry_number()` (0001), which is race-free.
--   quoteNextNumber      The Mongo version read the document, incremented, and
--   poNextNumber         saved — the exact race that function replaced. Only
--                        the PREFIX is configuration; the counter is not.
--   settings.currency    Already here as `base_currency`. Two columns for one
--                        fact is a drift waiting to happen.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Status, and the end of two flags for one fact.
--
--    Mongo has a three-valued `status` (active / inactive / suspended); here
--    there was a two-valued `is_active`, which the tenant gate reads on every
--    request. Carrying both would let them disagree — a company suspended in
--    the admin list whose books are still open is exactly the failure the
--    is_active gate was added to stop.
--
--    So `status` becomes the single truth and `is_active` becomes GENERATED
--    from it. Every existing reader keeps working, and no write can make them
--    disagree because is_active can no longer be written at all.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "companies" ADD COLUMN "status" text NOT NULL DEFAULT 'active';--> statement-breakpoint

UPDATE "companies"
   SET "status" = CASE WHEN "is_active" THEN 'active' ELSE 'inactive' END;--> statement-breakpoint

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_status_valid"
  CHECK ("status" IN ('active', 'inactive', 'suspended'));--> statement-breakpoint

ALTER TABLE "companies" DROP COLUMN "is_active";--> statement-breakpoint

ALTER TABLE "companies"
  ADD COLUMN "is_active" boolean
  GENERATED ALWAYS AS ("status" = 'active') STORED;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Identity, contact and address.
--
--    `code` is the short token that appears in document numbers (JE-QSL-REC-…)
--    and is unique across the platform, which is why it is not company-scoped.
--    Nullable for now: every tenant provisioned before this migration has none,
--    and refusing to load them until somebody types one in would be a worse
--    answer than a document number without a company token in it.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "companies"
  ADD COLUMN "code"        text,
  ADD COLUMN "tagline"     text,
  ADD COLUMN "logo"        text,
  ADD COLUMN "email"       text,
  ADD COLUMN "phone"       text,
  ADD COLUMN "website"     text,
  ADD COLUMN "street"      text,
  ADD COLUMN "city"        text,
  ADD COLUMN "state"       text,
  ADD COLUMN "postal_code" text,
  ADD COLUMN "country"     text NOT NULL DEFAULT 'Kenya';--> statement-breakpoint

CREATE UNIQUE INDEX "companies_code_uq"
  ON "companies" ("code") WHERE "code" IS NOT NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tax, legal and banking — what a document has to print.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "companies"
  ADD COLUMN "tax_pin"             text,
  ADD COLUMN "vat_number"          text,
  ADD COLUMN "registration_number" text,
  ADD COLUMN "bank_name"           text,
  ADD COLUMN "bank_branch"         text,
  ADD COLUMN "account_name"        text,
  ADD COLUMN "account_number"      text,
  ADD COLUMN "swift_code"          text,
  ADD COLUMN "mpesa_paybill"       text,
  ADD COLUMN "mpesa_till"          text;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Subscription.
--
--    On the company rather than in a table of its own: it is one row per
--    company, it is read with the company on every session refresh, and a join
--    to fetch one plan string is a join for nothing.
--
--    `max_users` allows -1, which lib/plans.js uses for unlimited. That is a
--    sentinel and it is ugly, but it is the one the plan code already speaks;
--    inventing NULL-means-unlimited here would give the same fact two spellings
--    across the two stores while both are live.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "companies"
  ADD COLUMN "plan"                  text NOT NULL DEFAULT 'free',
  ADD COLUMN "subscription_status"   text NOT NULL DEFAULT 'trial',
  ADD COLUMN "trial_ends_at"         timestamp with time zone,
  ADD COLUMN "current_period_start"  timestamp with time zone,
  ADD COLUMN "current_period_end"    timestamp with time zone,
  ADD COLUMN "max_users"             integer NOT NULL DEFAULT 2;--> statement-breakpoint

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_plan_valid"
  CHECK ("plan" IN ('free', 'starter', 'professional', 'enterprise'));--> statement-breakpoint

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_subscription_status_valid"
  CHECK ("subscription_status" IN ('active', 'trial', 'expired', 'cancelled'));--> statement-breakpoint

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_max_users_valid"
  CHECK ("max_users" = -1 OR "max_users" >= 0);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Conversion date — the cutover the opening balances hang off.
--
--    Opening-balance documents must be dated on or before it, which is a rule
--    the ledger enforces, so it belongs next to the ledger rather than one
--    store away from the check that reads it.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "companies"
  ADD COLUMN "conversion_date"       date,
  ADD COLUMN "conversion_set_by_id"  text,
  ADD COLUMN "conversion_set_by_name" text,
  ADD COLUMN "conversion_set_at"     timestamp with time zone;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Audit trail, in the same shape as the 47 actor columns of 0031: text ids
--    and a name snapshot, because there is no users table to reference yet.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "companies"
  ADD COLUMN "created_by_id"          text,
  ADD COLUMN "created_by_name"        text,
  ADD COLUMN "last_modified_by_id"    text,
  ADD COLUMN "last_modified_by_name"  text;--> statement-breakpoint

CREATE INDEX "companies_status_idx" ON "companies" ("status");--> statement-breakpoint
CREATE INDEX "companies_subscription_status_idx"
  ON "companies" ("subscription_status");--> statement-breakpoint

-- ============================================================================
-- 7. company_settings — what the books obey.
--
-- One row per company, created with the company. Separate from `companies`
-- because these are read on ledger paths INSIDE the transaction that acts on
-- them, and a rule read has no business carrying a logo and a bank account
-- along with it.
--
-- Every threshold is numeric(18,2), the same type the money columns use. They
-- are compared against amounts, and comparing a money value to a float is how
-- a 50,000.00 adjustment slips past a 50,000 threshold.
-- ============================================================================
CREATE TABLE "company_settings" (
  "company_id" uuid PRIMARY KEY REFERENCES "companies"("id") ON DELETE CASCADE,

  -- Locale and display. base_currency lives on companies; these are how it is
  -- rendered, not what it is.
  "currency_symbol" text NOT NULL DEFAULT 'KES',
  "locale"          text NOT NULL DEFAULT 'en-KE',
  "timezone"        text NOT NULL DEFAULT 'Africa/Nairobi',

  -- Tax
  "default_vat_rate"        numeric(9,4) NOT NULL DEFAULT 16,
  "enable_withholding_tax"  boolean      NOT NULL DEFAULT true,
  "default_wht_rate"        numeric(9,4) NOT NULL DEFAULT 5,

  -- Receiving. When on, bill approval posts to GR/IR clearing instead of
  -- crediting inventory, and stock is admitted only by an accepted GRN.
  "require_grn" boolean NOT NULL DEFAULT false,

  -- Fiscal year start month (1-12).
  "fiscal_year_start_month" integer NOT NULL DEFAULT 1,

  -- Document numbering. PREFIX ONLY — the counters are entry_counters (0001).
  "invoice_prefix" text NOT NULL DEFAULT 'INV',
  "bill_prefix"    text NOT NULL DEFAULT 'BILL',
  "quote_prefix"   text NOT NULL DEFAULT 'QT',
  "po_prefix"      text NOT NULL DEFAULT 'PO',

  -- Inventory
  "default_costing_method" text         NOT NULL DEFAULT 'average',
  "low_stock_threshold"    numeric(18,4) NOT NULL DEFAULT 10,

  -- Terms
  "default_payment_terms"      text    NOT NULL DEFAULT 'Net 30',
  "default_payment_terms_days" integer NOT NULL DEFAULT 30,

  -- A draft invoice holds committed stock for this many days before it is
  -- released back to available.
  "draft_invoice_expiry_days" integer NOT NULL DEFAULT 14,

  -- Items below this are expensed rather than capitalised. 0 disables.
  "capitalization_threshold" numeric(18,2) NOT NULL DEFAULT 0,

  -- Approval thresholds. 0 means "always require approval", which is why they
  -- are NOT NULL with a default rather than nullable — a null threshold reads
  -- as "no limit" to some callers and "no approval" to others.
  "stock_adjustment_value"  numeric(18,2) NOT NULL DEFAULT 50000,
  "stock_request_value"     numeric(18,2) NOT NULL DEFAULT 100000,
  "stock_high_risk_types"   text[]        NOT NULL DEFAULT ARRAY['theft','write_off','expiry'],
  "minimum_margin_percent"  numeric(9,4)  NOT NULL DEFAULT 8,
  "credit_note_value"       numeric(18,2) NOT NULL DEFAULT 25000,
  "bill_payment_value"      numeric(18,2) NOT NULL DEFAULT 100000,
  "expense_payment_value"   numeric(18,2) NOT NULL DEFAULT 50000,
  "discount_cap_percent"    numeric(9,4)  NOT NULL DEFAULT 15,

  -- Feature flags. Explicit columns rather than a jsonb blob: each one is a
  -- gate somewhere in the code, and a gate you cannot grep for is a gate
  -- nobody maintains.
  "feature_inventory"          boolean NOT NULL DEFAULT true,
  "feature_sales"              boolean NOT NULL DEFAULT true,
  "feature_purchases"          boolean NOT NULL DEFAULT true,
  "feature_accounting"         boolean NOT NULL DEFAULT true,
  "feature_expenses"           boolean NOT NULL DEFAULT true,
  "feature_reports"            boolean NOT NULL DEFAULT true,
  "feature_multi_currency"     boolean NOT NULL DEFAULT false,
  "feature_advanced_reporting" boolean NOT NULL DEFAULT false,
  "feature_api_access"         boolean NOT NULL DEFAULT false,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "company_settings_fiscal_month_valid"
    CHECK ("fiscal_year_start_month" BETWEEN 1 AND 12),
  CONSTRAINT "company_settings_costing_valid"
    CHECK ("default_costing_method" IN ('average', 'fifo', 'lifo')),
  CONSTRAINT "company_settings_draft_expiry_valid"
    CHECK ("draft_invoice_expiry_days" BETWEEN 1 AND 90),
  CONSTRAINT "company_settings_margin_valid"
    CHECK ("minimum_margin_percent" BETWEEN 0 AND 100),
  CONSTRAINT "company_settings_discount_valid"
    CHECK ("discount_cap_percent" BETWEEN 0 AND 100),
  CONSTRAINT "company_settings_prefixes_present"
    CHECK (
      length(btrim("invoice_prefix")) > 0 AND
      length(btrim("bill_prefix"))    > 0 AND
      length(btrim("quote_prefix"))   > 0 AND
      length(btrim("po_prefix"))      > 0
    )
);--> statement-breakpoint

-- Every company that already exists gets the defaults, so nothing has to cope
-- with a missing settings row. Provisioning inserts one from now on.
INSERT INTO "company_settings" ("company_id")
SELECT "id" FROM "companies"
ON CONFLICT ("company_id") DO NOTHING;--> statement-breakpoint

ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenant_isolation ON "company_settings"
  USING ("company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "company_settings" TO app_user;--> statement-breakpoint

-- No DELETE: a settings row is deleted only with its company, which cascades.
-- Handing app_user DELETE would let a tenant drop its own rules and fall back
-- to whatever a missing row means, which is nothing anybody has decided.

-- ============================================================================
-- 8. Numbering honours the configured prefix.
--
-- next_entry_number(company, prefix) stays exactly as it is — it is the
-- race-free counter and it is correct. What was missing is that the CALLERS
-- passed a literal. This resolves the tenant's configured prefix for a
-- document kind, so `next_entry_number(c, document_prefix(c, 'invoice'))`
-- numbers an invoice the way the tenant asked to have it numbered.
--
-- Falls back to the platform default for a kind that has no setting, rather
-- than returning null and producing a document numbered "-00001".
-- ============================================================================
CREATE OR REPLACE FUNCTION document_prefix(p_company_id uuid, p_kind text)
RETURNS text AS $$
DECLARE
  v_prefix text;
BEGIN
  SELECT CASE p_kind
           WHEN 'invoice' THEN s.invoice_prefix
           WHEN 'bill'    THEN s.bill_prefix
           WHEN 'quote'   THEN s.quote_prefix
           WHEN 'po'      THEN s.po_prefix
         END
    INTO v_prefix
    FROM company_settings s
   WHERE s.company_id = p_company_id;

  IF v_prefix IS NULL OR btrim(v_prefix) = '' THEN
    v_prefix := CASE p_kind
                  WHEN 'invoice' THEN 'INV'
                  WHEN 'bill'    THEN 'BILL'
                  WHEN 'quote'   THEN 'QT'
                  WHEN 'po'      THEN 'PO'
                  ELSE upper(p_kind)
                END;
  END IF;

  RETURN v_prefix;
END;
$$ LANGUAGE plpgsql STABLE;

-- SECURITY INVOKER on purpose. company_settings is under RLS keyed on
-- app.company_id, and every caller runs inside withTenant with that set, so the
-- function reads the tenant's own row through the same policy as everything
-- else. A SECURITY DEFINER here would read ANY company's settings and would be
-- the one hole in an otherwise closed table.

-- ============================================================================
-- 0059 — Expenses.
--
-- The SEVENTH module posting into the Mongo ledger, and the one the sweep
-- missed three times. The count went four → five → six as the search widened
-- from `app/mongodb/actions/` to `lib/`; expenses is in neither. Its postings
-- are in the MODEL — `app/models/expenses.js:608` and `:695` — reached through
-- `expense-actions.js`, which reads like a thin wrapper. §9G already names
-- expenses, but as a PARTY seam (it calls Mongo's quickCreateParty), so nobody
-- read further into what it posts.
--
-- The path is live: ExpenseForm → createExpense → expense.post(). Every
-- expense a user has entered went into a ledger no screen reads.
--
-- Two postings, not three. The third `.post(` in the model is `post("init")`,
-- a Mongoose read hook that backfills `paymentStatus` — see decision 2.
--
--   post()          DR Expense [/ DR VAT Input]  CR Cash|Bank|Mpesa   (paid)
--                                                CR Accrued Expenses  (unpaid)
--   recordPayment() DR Accrued Expenses          CR Cash|Bank|Mpesa
--
-- ── Six decisions ───────────────────────────────────────────────────────────
--
-- 1. THE LEGACY STATUSES ARE GONE.
--    The Mongo enum carries `pending`, `approved` and `rejected` with a
--    comment saying they are "no longer created by the current workflow" —
--    and it is right, nothing creates them. What the comment does not say is
--    that two queries still LOOK for them: approval-queries.js:110 and
--    pending-approvals-queries.js:144 both filter `status: "pending"`, so the
--    approvals badge and the pending-expenses strip have been counting a
--    status that cannot occur. There is no data to migrate (fresh deploy), so
--    the enum here is the four states the flow actually produces.
--
-- 2. `payment_status` IS DERIVED, NOT STORED.
--    Mongo stores it, defaults it to "unpaid" on read, and then needs a
--    `post("init")` hook to correct the default for rows written before the
--    field existed — a stored value that is wrong often enough to need a
--    repair pass on every single read. It is a function of `paid_at`:
--    generated here, and the hook has nothing left to repair.
--
-- 3. `total` IS GENERATED; `subtotal` IS GONE.
--    `validateAmounts()` computes `subtotal = amount` and
--    `total = amount + tax - wht`, and it is a method — any write that does
--    not call it leaves both stale. `subtotal` is a verbatim copy of `amount`
--    and carries no information at all.
--
-- 4. NO SELF-HEALING ACCRUAL ACCOUNT.
--    post() will, when `accrued_expenses` is not tagged, adopt an account
--    named "Accrued Expenses", else CREATE code 2170, else — on a duplicate
--    key — adopt whatever holds 2170 and retag it. Three fallbacks that write
--    to the chart of accounts from inside an expense posting. The account is
--    seeded by lib/chart-of-accounts.js:278, which app/db/provisioning.ts uses,
--    so on a fresh deploy it is always there; a company missing it gets a
--    readable error instead of a chart of accounts silently rewritten.
--
-- 5. RECEIPTS ARE A TABLE.
--    An embedded array in Mongo. As a table they can be added to and removed
--    from without rewriting the expense, which is what the form actually does:
--    `updateExpense` assigns `expense.receipts = receipts` wholesale, so
--    editing an expense and uploading nothing DELETED every receipt on it.
--
-- 6. THE PROJECT LINK IS `text`, THE ASSET LINK IS `uuid`.
--    Exactly as 0053/0054 and 0057 settled it for bills: projects are still
--    Mongo, so the id is an ObjectId; fixed assets moved in 0056, so the id is
--    a uuid and can carry a real foreign key. `app/models/expenses.js` already
--    documents its half of this — `asset.id` is a String there precisely
--    because Mongoose could not cast a uuid.
--
-- ── What is NOT decided here ────────────────────────────────────────────────
--
-- The payment approval threshold still routes through Mongo's ApprovalRequest
-- (`submitApproval`, `applyExpensePayment`). Approvals are their own unported
-- module; this migration does not pull them across. What changes is which
-- store the apply step writes to.
-- ============================================================================

CREATE TYPE "public"."expense_status" AS ENUM ('draft', 'posted', 'paid', 'void');--> statement-breakpoint

CREATE TYPE "public"."expense_category" AS ENUM (
  'utilities', 'rent', 'salaries', 'transport', 'office_supplies', 'insurance',
  'maintenance', 'marketing', 'legal_professional', 'bank_charges',
  'depreciation', 'meals_entertainment', 'telecommunications', 'training',
  'materials', 'subscriptions', 'security', 'cleaning', 'licenses_permits',
  'printing_stationery', 'courier_postage', 'other'
);--> statement-breakpoint

-- Mirrors the Mongo enum minus "unpaid": "unpaid" is not a payment method, it
-- is the absence of one, and conflating the two is what lets an expense carry
-- paymentMethod: "cash" with no account behind it — the state postLegacyExpense
-- has a special case for. Here the column is NULL until money moves.
CREATE TYPE "public"."expense_payment_method" AS ENUM (
  'cash', 'mpesa', 'bank_transfer', 'cheque', 'card'
);--> statement-breakpoint

CREATE TABLE "expenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE restrict,

  "expense_number" text NOT NULL,
  "expense_date" date NOT NULL,
  "category" "expense_category" NOT NULL,

  -- ── The expense account, and what it was called ──────────────────────────
  -- §9.4: the code and name are snapshots. Renaming an account must not
  -- rewrite the description of an expense already in the ledger.
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE restrict,
  "account_code_at_expense" text NOT NULL,
  "account_name_at_expense" text NOT NULL,

  -- ── Amounts ──────────────────────────────────────────────────────────────
  "amount" numeric(19,4) NOT NULL,
  "tax_amount" numeric(19,4) DEFAULT '0' NOT NULL,
  "tax_rate" numeric(5,2) DEFAULT '0' NOT NULL,
  "withholding_tax" numeric(19,4) DEFAULT '0' NOT NULL,
  "total" numeric(19,4) GENERATED ALWAYS AS (amount + tax_amount - withholding_tax) STORED,
  "currency" text DEFAULT 'KES' NOT NULL,

  -- ── Payment ──────────────────────────────────────────────────────────────
  -- All three move together or not at all: an expense is paid when there is a
  -- date, an account and a method, and unpaid when there is none of them. The
  -- CHECK is what makes `payment_status` derivable.
  "payment_method" "expense_payment_method",
  "paid_from_account_id" uuid REFERENCES "accounts"("id") ON DELETE restrict,
  "paid_at" timestamptz,
  "payment_status" text GENERATED ALWAYS AS (
    CASE WHEN paid_at IS NULL THEN 'unpaid' ELSE 'paid' END
  ) STORED,

  -- ── Payee: supplier or employee ──────────────────────────────────────────
  -- Optional FK, required snapshot — the Mongo shape, where `vendor.name` is
  -- required and `vendor.id` is not. `payee_type` drives journal_entries
  -- .party_type so employee balances aggregate under the right heading.
  "payee_party_id" uuid REFERENCES "parties"("id") ON DELETE restrict,
  "payee_type" "party_type" DEFAULT 'supplier' NOT NULL,
  "payee_name_at_expense" text NOT NULL,
  "payee_phone_at_expense" text,
  "payee_email_at_expense" text,
  "payee_tax_pin_at_expense" text,

  -- ── Description ──────────────────────────────────────────────────────────
  "description" text NOT NULL,
  "reference" text,
  "supplier_invoice_number" text,
  "notes" text,

  -- ── Optional links ───────────────────────────────────────────────────────
  -- text, not uuid: still a Mongo ObjectId until projects are ported (0053).
  "project_id" text,
  "project_number_at_expense" text,
  "project_name_at_expense" text,
  "cost_code_id" text,
  "cost_code_at_expense" text,
  -- uuid with a real FK: fixed assets moved in 0056, the way bills' did in 0057.
  "asset_id" uuid REFERENCES "assets"("id") ON DELETE set null,
  "asset_number_at_expense" text,
  "asset_name_at_expense" text,

  -- ── Employee reimbursement ───────────────────────────────────────────────
  "is_reimbursable" boolean DEFAULT false NOT NULL,
  "employee_party_id" uuid REFERENCES "parties"("id") ON DELETE restrict,
  "employee_name_at_expense" text,
  "reimbursed_at" timestamptz,
  "reimbursed_by_id" text REFERENCES "users"("id") ON DELETE set null,

  -- ── Status and the ledger ────────────────────────────────────────────────
  "status" "expense_status" DEFAULT 'draft' NOT NULL,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE restrict,
  "clearing_journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE restrict,

  "posted_at" timestamptz,
  "posted_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "voided_at" timestamptz,
  "voided_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "void_reason" text,

  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "last_modified_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,

  -- min: [0.01] on the Mongo schema, which is a validator and so applies only
  -- to writes that run validation.
  CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "expenses_tax_non_negative"
    CHECK ("tax_amount" >= 0 AND "withholding_tax" >= 0 AND "tax_rate" >= 0 AND "tax_rate" <= 100),
  -- "Total amount cannot be negative", thrown by validateAmounts() — a method,
  -- so only enforced where it is called.
  CONSTRAINT "expenses_total_non_negative"
    CHECK ("amount" + "tax_amount" - "withholding_tax" >= 0),

  -- The three payment columns are all set or all null. Without this,
  -- `payment_status` would be derivable from `paid_at` while `payment_method`
  -- said something else — which is the exact state postLegacyExpense exists to
  -- clean up ("has paymentMethod but no paidFrom").
  CONSTRAINT "expenses_payment_is_whole" CHECK (
    ("paid_at" IS NULL AND "payment_method" IS NULL AND "paid_from_account_id" IS NULL)
    OR ("paid_at" IS NOT NULL AND "payment_method" IS NOT NULL AND "paid_from_account_id" IS NOT NULL)
  ),

  -- A posted expense has an entry; a draft does not. `post()` sets the status
  -- and the entry id in the same save, so nothing in the Mongo flow INTENDS to
  -- separate them — but a failure between JournalEntry.create() and
  -- expense.save() leaves an entry in the ledger with no expense pointing at
  -- it, which is what postLegacyExpense's "already has a JE" branch is for.
  CONSTRAINT "expenses_posted_has_entry" CHECK (
    ("status" = 'draft' AND "journal_entry_id" IS NULL)
    OR ("status" <> 'draft' AND "journal_entry_id" IS NOT NULL)
  ),

  -- The clearing entry belongs to the accrual path only: it exists when an
  -- expense was posted unpaid and paid later. An expense paid at entry has one
  -- entry, not two.
  CONSTRAINT "expenses_clearing_needs_payment" CHECK (
    "clearing_journal_entry_id" IS NULL OR "paid_at" IS NOT NULL
  ),

  CONSTRAINT "expenses_void_has_reason" CHECK (
    "status" <> 'void' OR "voided_at" IS NOT NULL
  )
);--> statement-breakpoint

-- The Mongo unique index, kept.
CREATE UNIQUE INDEX "expenses_number_unique" ON "expenses" ("company_id", "expense_number");--> statement-breakpoint

-- Mongo's query indexes, tenant-prefixed the same way.
CREATE INDEX "expenses_list_idx" ON "expenses" ("company_id", "expense_date" DESC, "status");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" ("company_id", "category", "status");--> statement-breakpoint
CREATE INDEX "expenses_payee_idx" ON "expenses" ("company_id", "payee_party_id");--> statement-breakpoint
CREATE INDEX "expenses_reimbursable_idx" ON "expenses" ("company_id", "is_reimbursable", "employee_party_id");--> statement-breakpoint
-- getAssetExpenses rolls running costs up by asset.
CREATE INDEX "expenses_asset_idx" ON "expenses" ("company_id", "asset_id", "expense_date" DESC);--> statement-breakpoint
-- Not in Mongo: the accrual ageing question — what is posted and still unpaid.
-- `payment_status` is generated, so this index cannot drift from it.
CREATE INDEX "expenses_unpaid_idx" ON "expenses" ("company_id", "payment_status", "expense_date" DESC);--> statement-breakpoint
CREATE INDEX "expenses_project_idx" ON "expenses" ("company_id", "project_id")
  WHERE "project_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "expense_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE restrict,
  "expense_id" uuid NOT NULL REFERENCES "expenses"("id") ON DELETE cascade,
  "filename" text NOT NULL,
  "url" text NOT NULL,
  "public_id" text,
  "resource_type" text,
  "size" integer,
  "mime_type" text,
  "uploaded_at" timestamptz DEFAULT now() NOT NULL,
  "uploaded_by_id" text REFERENCES "users"("id") ON DELETE set null
);--> statement-breakpoint

CREATE INDEX "expense_receipts_expense_idx" ON "expense_receipts" ("expense_id");--> statement-breakpoint

ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expense_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- ============================================================================
-- 0060 — Petty cash returns. The LAST module posting into the Mongo ledger.
--
-- `petty-cash-actions.js:101` posts through the Mongo JournalEntry model while
-- every ledger screen reads Postgres. One posting — `fundPettyCash`, which
-- moves money from the bank into the tin (DR Petty Cash / CR Bank). Approval
-- posts nothing, correctly: the spends are Expenses that posted themselves,
-- and the top-ups posted at fund time. Sign-off is a signature, not an entry.
--
-- The statement half already moved with expenses (0059) — see
-- computePettyCashStatement, which is why expenses had to go first. This is
-- the write side, and with it no Mongo module holds a journal posting.
--
-- ── What the port found ─────────────────────────────────────────────────────
--
-- 1. THE SIGNED STATEMENT IS NOT THE ONE ON THE SCREEN.
--
--    `submitPettyCashReturn` and `approvePettyCashReturn` both call
--    snapshotTotals(), which freezes the GL-derived opening balance and totals
--    onto the return — the point being that "the list and the approved record
--    show a stable figure", in the code's own words.
--
--    And then `getPettyCashReturnById` does this:
--
--        return serializeBsonType({
--          ...ret,
--          openingBalance: statement.openingBalance,   <-- overrides the freeze
--          rows: statement.rows,
--          totals: statement.totals,                   <-- and this one
--        });
--
--    It spreads the stored return and then overwrites both frozen figures with
--    a LIVE recomputation. So the detail page of an APPROVED return does not
--    show what was approved: book an expense afterwards, dated inside the
--    period, and the signed return silently changes. The freeze is only ever
--    visible on the list.
--
--    Here the frozen figures are columns and the live statement is offered
--    beside them, not on top of them. A return that has been signed shows what
--    was signed, and a drift from the live GL is something the screen can say
--    out loud instead of hiding by agreeing with itself.
--
-- 2. `rejected` IS NEVER WRITTEN.
--
--    The status enum has four values and `rejectPettyCashReturn` sets
--    `ret.status = "draft"`. So a rejected return is indistinguishable from one
--    never submitted, except by a `rejectionReason` string that the draft it
--    became does not clear. This is the same shape as the expense statuses
--    (§9J) and it is the eighth instance found. Here reject means rejected,
--    and the custodian resubmits from there.
--
-- 3. NOTHING STOPS TWO RETURNS COVERING THE SAME PERIOD.
--
--    `createPettyCashReturn` checks that the float exists and that dates were
--    supplied. It does not check for an existing return over the same float
--    and the same days — so the same spend can be put on two statements and
--    signed off twice. An EXCLUDE constraint makes it impossible rather than
--    unlikely; btree_gist is already enabled (0046) and leave requests and
--    payroll configs both use the same shape.
--
-- 4. THE UNBALANCED-JOURNAL TOLERANCE, one of §9.2's six.
--
--        if (Math.abs(totalD - totalC) > 0.01) throw ...
--
--    A petty cash entry may be out by up to a cent. It does not survive: the
--    balance of a journal entry has been the database's job since 0001.
--
-- ── Not carried over ────────────────────────────────────────────────────────
--
-- `totals.closing` is stored in Mongo and is arithmetic — opening + debits −
-- credits. Generated here. The three inputs are stored because they are a
-- deliberate freeze of a derived figure at a moment in time, which is a
-- different thing from a cache that goes stale: nothing should update them
-- afterwards, and nothing can.
-- ============================================================================

CREATE TYPE "public"."petty_cash_return_status" AS ENUM (
  'draft', 'submitted', 'approved', 'rejected'
);--> statement-breakpoint

CREATE TABLE "petty_cash_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE restrict,

  "document_number" text NOT NULL,

  -- The tin. Several floats per company are supported, which is why the
  -- overlap constraint below is per float rather than per company.
  "float_account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE restrict,

  "custodian_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "custodian_party_id" uuid REFERENCES "parties"("id") ON DELETE set null,
  -- §9.4 — what the form said, so a renamed custodian does not rewrite a
  -- return they signed two years ago.
  "custodian_name_at_return" text,

  "period_from" date NOT NULL,
  "period_to" date NOT NULL,

  -- ── The FROZEN statement ─────────────────────────────────────────────────
  -- Written by submit and re-written by approve, and by nothing else. Null
  -- while the return is a draft: a draft has no frozen figure, it has a live
  -- one, and storing a zero would make "not yet frozen" and "frozen at zero"
  -- the same state.
  "opening_balance" numeric(19,4),
  "total_debits" numeric(19,4),
  "total_credits" numeric(19,4),
  "closing_balance" numeric(19,4) GENERATED ALWAYS AS
    (opening_balance + total_debits - total_credits) STORED,
  -- What the GL said the float held at the moment of the freeze. The screen
  -- reports over/short from the difference; storing it means the signed
  -- variance stays the signed variance.
  "gl_closing_balance" numeric(19,4),
  "frozen_at" timestamptz,

  "status" "petty_cash_return_status" DEFAULT 'draft' NOT NULL,

  "prepared_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "prepared_at" timestamptz,
  "reviewed_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "reviewed_at" timestamptz,
  "approved_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "approved_at" timestamptz,

  "rejection_reason" text,
  "notes" text,

  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT "petty_cash_returns_period_ordered"
    CHECK ("period_to" >= "period_from"),

  -- The three frozen figures move together or not at all, and `frozen_at`
  -- says when. Without this, `closing_balance` would be NULL whenever any one
  -- of them was, which reads as "no closing balance" rather than as a bug.
  CONSTRAINT "petty_cash_returns_freeze_is_whole" CHECK (
    ("opening_balance" IS NULL AND "total_debits" IS NULL
      AND "total_credits" IS NULL AND "frozen_at" IS NULL)
    OR ("opening_balance" IS NOT NULL AND "total_debits" IS NOT NULL
      AND "total_credits" IS NOT NULL AND "frozen_at" IS NOT NULL)
  ),

  -- A return that has been submitted has been frozen. A draft has not.
  CONSTRAINT "petty_cash_returns_submitted_is_frozen" CHECK (
    "status" = 'draft' OR "frozen_at" IS NOT NULL
  ),

  CONSTRAINT "petty_cash_returns_totals_non_negative" CHECK (
    "total_debits" IS NULL
    OR ("total_debits" >= 0 AND "total_credits" >= 0)
  ),

  CONSTRAINT "petty_cash_returns_rejection_has_reason" CHECK (
    "status" <> 'rejected'
    OR ("rejection_reason" IS NOT NULL AND btrim("rejection_reason") <> '')
  )
);--> statement-breakpoint

CREATE UNIQUE INDEX "petty_cash_returns_number_unique"
  ON "petty_cash_returns" ("company_id", "document_number");--> statement-breakpoint

-- ONE RETURN PER FLOAT PER PERIOD. Finding 3 above: without this the same
-- spend can appear on two statements and be signed off twice.
--
-- Rejected returns are excluded — a rejected period must be re-openable, or a
-- mistake would lock the custodian out of the days it covered. daterange is
-- [from, to] inclusive on both ends, which is how the form reads.
ALTER TABLE "petty_cash_returns"
  ADD CONSTRAINT "petty_cash_returns_no_overlap" EXCLUDE USING gist (
    "company_id" WITH =,
    "float_account_id" WITH =,
    daterange("period_from", "period_to", '[]') WITH &&
  ) WHERE ("status" <> 'rejected');--> statement-breakpoint

CREATE INDEX "petty_cash_returns_list_idx"
  ON "petty_cash_returns" ("company_id", "period_from" DESC, "status");--> statement-breakpoint
CREATE INDEX "petty_cash_returns_float_idx"
  ON "petty_cash_returns" ("company_id", "float_account_id", "status");--> statement-breakpoint

-- The float top-up posts a journal entry; this is what links it back.
ALTER TYPE "public"."source_document_type" ADD VALUE IF NOT EXISTS 'petty_cash_return';--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER TABLE "petty_cash_returns" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "petty_cash_returns" FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON "petty_cash_returns"
    USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "petty_cash_returns" TO app_user;

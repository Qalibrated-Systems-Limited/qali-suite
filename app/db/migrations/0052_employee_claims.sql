-- ============================================================================
-- 0052 — Employee claims: advances, their settlement, and reimbursements.
--
-- §9G's table said four modules still post journal entries into MongoDB while
-- every ledger screen reads Postgres. It was six, and this is the largest of
-- them: `claim-action.js` holds seven `JournalEntry.post()` calls, six of them
-- reachable. Nothing errored. The entries were created, validated and posted
-- into a ledger nothing reads — so advances went out, expenses were
-- recognised, employees were reimbursed, and the books never saw any of it.
--
-- The six, in the order the flow runs them:
--
--   payAdvance            DR Employee Advance   CR Bank
--   closeSettlement       DR Expense accounts   CR Employee Advance
--                                               (+ Payables where overspent)
--   recordAdvanceReturn   DR Bank               CR Employee Advance
--   paySettlementBalance  DR Employee Payables  CR Bank
--   payReimbursement #1   DR Expense accounts   CR Employee Payables
--   payReimbursement #2   DR Employee Payables  CR Bank
--
-- The seventh is inside `closeSettlementt` — three t's, 573 lines, and nothing
-- imports it. `CloseSettlementDialog` binds `closeSettlement`. It is not
-- ported; a duplicate of a money path, kept alive by a typo, is worth less
-- than the confusion it causes.
--
-- ── Six decisions ───────────────────────────────────────────────────────────
--
-- 1. AN EXPENSE ITEM MUST NAME ITS EXPENSE ACCOUNT.
--    Both posting paths group items with
--
--        const key = item.expenseAccountId?.toString() || item.category;
--
--    and then look each group up in the map `resolveExpenseAccounts` built —
--    which only ever keys by ACCOUNT ID, because it skips items that have
--    none. An item saved without an expense account therefore produces a key
--    that is a category name, `expenseAccountMap[category]` is undefined, and
--    `account._id` throws TypeError partway through posting. The claim is
--    approved, the payment is half-made, and nothing reaches the ledger.
--
--    `expense_account_id` is NOT NULL with a foreign key. The failure moves to
--    the form, where somebody can still fix it.
--
-- 2. AN ADVANCE IS SETTLED ONCE.
--    The Mongo schema carries the invariant as a comment on
--    `settlementClaimId`: "Prevents double settlement". Nothing enforced it,
--    and `settleAdvance` only looks for an existing settlement with a query
--    that excludes rejected ones — a read-then-write with no lock, which two
--    concurrent settlements both pass. Each would then credit Employee Advance
--    in full and the advance would be cleared twice.
--
--    `employee_claims_advance_settled_once` is a unique index on
--    (company_id, advance_claim_id), excluding rejected settlements exactly as
--    `settleAdvance`'s own check does. The second one cannot be written.
--
--    The direction is reversed from Mongo too: the settlement points at its
--    advance, rather than both pointing at each other. §8.2 — two sources of
--    truth for the same fact is how they come to disagree.
--
-- 3. ONE ENTRY PER PURPOSE PER CLAIM.
--    `journalEntryIds` was an unconstrained array, so a second `payAdvance` on
--    the same claim appended a second DR Employee Advance. The status guard
--    (`claim.status !== "approved"`) is a read-then-check, which is exactly
--    the shape §8.3 documents for COGS double-posting.
--
--    `employee_claim_journal_entries` names the event — advance, settlement,
--    return, expense, payment — and is unique on (claim_id, purpose).
--
-- 4. TOTALS ARE DERIVED.
--    `totalAmount`, `returnDetails.totalSpent` and `returnDetails.balance`
--    were stored, recomputed by three `validate*` methods that only ran from
--    `submit()` and `approve()`. Every other write path left them stale. They
--    are columns of `employee_claim_state` now (§4.4).
--
-- 5. ITEMS FREEZE ONCE THE CLAIM IS APPROVED.
--    Since the total is the sum of the items, and the journal entry is built
--    from the items, editing an item after approval silently changes what the
--    ledger was told. `updateClaim` guards this at ONE call site. The trigger
--    guards it at all of them. The draft-or-rejected rule for user edits stays
--    in `updateClaim` — see the note on the trigger for why the DATABASE draws
--    its line at approval instead.
--
-- 6. IDENTITY HAS ONE COPY.
--    `employee.{userId, partyId, name, employeeNumber, department, email}` —
--    six fields, four of them copies. `getEmployeeHRSnapshot` already reads
--    Postgres for the last two, so they were never a historical snapshot,
--    only a stale copy of current HR. `party_id` is required, `employee_id` is
--    nullable — "a claim raised by somebody with no HR record is still a
--    claim" — and the rest is joined. §9F's correction, applied again.
--
-- NOT changed: a manager may still approve a claim they submitted themselves.
-- 0051 pushed three-hands separation into nonconformance, and the same
-- argument applies here, but claims are raised in one-person tenants where the
-- admin is also the claimant — so making it a constraint would break a live
-- flow to fix a control weakness nobody has asked about. Recorded, not done.
-- ============================================================================

ALTER TYPE "public"."journal_entry_type"
  ADD VALUE IF NOT EXISTS 'advance_return';--> statement-breakpoint

ALTER TYPE "public"."source_document_type"
  ADD VALUE IF NOT EXISTS 'employee_claim';--> statement-breakpoint

CREATE TYPE "public"."employee_claim_type" AS ENUM (
  'advance_request', 'advance_return', 'reimbursement'
);--> statement-breakpoint

CREATE TYPE "public"."employee_claim_status" AS ENUM (
  'draft', 'submitted', 'approved', 'rejected', 'paid',
  'pending_return', 'pending_payment', 'closed'
);--> statement-breakpoint

ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "claim_prefix" text NOT NULL DEFAULT 'CLAIM';--> statement-breakpoint

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
           WHEN 'grn'     THEN s.grn_prefix
           WHEN 'ncr'     THEN s.ncr_prefix
           WHEN 'claim'   THEN s.claim_prefix
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
                  WHEN 'grn'     THEN 'GRN'
                  WHEN 'ncr'     THEN 'NCR'
                  WHEN 'claim'   THEN 'CLAIM'
                  ELSE upper(p_kind)
                END;
  END IF;

  RETURN v_prefix;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "employee_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "claim_number" text NOT NULL,
  "claim_date" date NOT NULL,
  "claim_type" "employee_claim_type" NOT NULL,
  "status" "employee_claim_status" NOT NULL DEFAULT 'draft',

  -- Identity: one copy. See decision 6.
  "party_id" uuid NOT NULL,
  "employee_id" uuid,
  "employee_user_id" text,

  -- Projects are not ported (§10) — carried without a foreign key, the way
  -- bills carry purchase_order_id in 0015.
  "project_id" uuid,
  "project_number" text,
  "project_name" text,
  "cost_code_id" uuid,
  "cost_code_code" text,
  "cost_code_name" text,

  -- advance_request
  "advance_type" text,
  "requested_amount" numeric(19,4),
  "purpose" text,
  "travel_from" date,
  "travel_to" date,
  "destination" text,
  "estimated_expenses" text,
  "approved_amount" numeric(19,4),
  "disbursement_date" date,

  -- advance_return
  "advance_claim_id" uuid,
  -- Nullable and, for now, unwritten. `payAdvance` assigns
  -- `claim.advancePaymentId = journalEntry[0]._id` — a JOURNAL ENTRY id, into
  -- a field the Mongo schema declares `ref: "Payment"` — and `settleAdvance`
  -- copies it onward as though it were one. No payment document is created by
  -- either path. The foreign key here makes the column honest: it holds a
  -- payment or it holds nothing, and which journal entry funded the advance is
  -- `employee_claim_journal_entries.purpose = 'advance'`.
  "advance_payment_id" uuid,
  -- A genuine freeze (§9.4): what was actually disbursed, as at the moment the
  -- settlement opened. Not derivable afterwards if the advance is amended.
  "advance_amount" numeric(19,4),
  "amount_returned" numeric(19,4) NOT NULL DEFAULT 0,
  "return_recorded_at" timestamp with time zone,
  "return_recorded_by_id" text,
  "return_recorded_by_name" text,
  "amount_paid_to_employee" numeric(19,4) NOT NULL DEFAULT 0,
  "extra_paid_at" timestamp with time zone,
  "extra_paid_by_id" text,
  "extra_paid_by_name" text,

  "currency" text NOT NULL DEFAULT 'KES',
  "description" text NOT NULL,
  "notes" text,

  "submitted_at" timestamp with time zone,
  "submitted_by_id" text,
  "submitted_by_name" text,
  "approved_at" timestamp with time zone,
  "approved_by_id" text,
  "approved_by_name" text,
  "rejected_at" timestamp with time zone,
  "rejected_by_id" text,
  "rejected_by_name" text,
  "rejection_reason" text,

  "settlement_payment_id" uuid,
  "paid_at" timestamp with time zone,

  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "employee_claims_advance_fields" CHECK (
    "claim_type" <> 'advance_request'
    OR ("requested_amount" IS NOT NULL AND "requested_amount" > 0
        AND "purpose" IS NOT NULL)
  ),
  CONSTRAINT "employee_claims_return_fields" CHECK (
    "claim_type" <> 'advance_return'
    OR ("advance_claim_id" IS NOT NULL AND "advance_amount" IS NOT NULL
        AND "advance_amount" >= 0)
  ),
  CONSTRAINT "employee_claims_settlement_only_amounts" CHECK (
    "claim_type" = 'advance_return'
    OR ("amount_returned" = 0 AND "amount_paid_to_employee" = 0)
  ),
  CONSTRAINT "employee_claims_amounts_non_negative" CHECK (
    "amount_returned" >= 0 AND "amount_paid_to_employee" >= 0
    AND COALESCE("approved_amount", 0) >= 0
  ),
  -- The action required 10 characters of explanation. A rejection written any
  -- other way skipped it.
  CONSTRAINT "employee_claims_rejection_has_reason" CHECK (
    "status" <> 'rejected'
    OR ("rejection_reason" IS NOT NULL AND length(btrim("rejection_reason")) >= 10)
  ),
  CONSTRAINT "employee_claims_travel_dates_ordered" CHECK (
    "travel_from" IS NULL OR "travel_to" IS NULL OR "travel_to" >= "travel_from"
  )
);--> statement-breakpoint

ALTER TABLE "employee_claims"
  ADD CONSTRAINT "employee_claims_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
  ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "employee_claims"
  ADD CONSTRAINT "employee_claims_party_id_fk"
  FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id")
  ON DELETE restrict;--> statement-breakpoint

ALTER TABLE "employee_claims"
  ADD CONSTRAINT "employee_claims_employee_id_fk"
  FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id")
  ON DELETE set null;--> statement-breakpoint

ALTER TABLE "employee_claims"
  ADD CONSTRAINT "employee_claims_employee_user_id_fk"
  FOREIGN KEY ("employee_user_id") REFERENCES "public"."users"("id")
  ON DELETE set null;--> statement-breakpoint

-- The settlement points at its advance. One direction only — decision 2.
ALTER TABLE "employee_claims"
  ADD CONSTRAINT "employee_claims_advance_claim_id_fk"
  FOREIGN KEY ("advance_claim_id") REFERENCES "public"."employee_claims"("id")
  ON DELETE restrict;--> statement-breakpoint

ALTER TABLE "employee_claims"
  ADD CONSTRAINT "employee_claims_advance_payment_id_fk"
  FOREIGN KEY ("advance_payment_id") REFERENCES "public"."payments"("id")
  ON DELETE set null;--> statement-breakpoint

ALTER TABLE "employee_claims"
  ADD CONSTRAINT "employee_claims_settlement_payment_id_fk"
  FOREIGN KEY ("settlement_payment_id") REFERENCES "public"."payments"("id")
  ON DELETE set null;--> statement-breakpoint

CREATE UNIQUE INDEX "employee_claims_number_unique"
  ON "employee_claims" ("company_id", "claim_number");--> statement-breakpoint

-- Rejected settlements are excluded, which is what `settleAdvance` intended:
-- its own duplicate check reads `status: { $nin: ["rejected"] }`. A settlement
-- that was turned down has to be replaceable. Resubmitting the old one once a
-- replacement exists trips this index instead, which is the same answer.
CREATE UNIQUE INDEX "employee_claims_advance_settled_once"
  ON "employee_claims" ("company_id", "advance_claim_id")
  WHERE "advance_claim_id" IS NOT NULL AND "status" <> 'rejected';--> statement-breakpoint

CREATE INDEX "employee_claims_list_idx"
  ON "employee_claims" ("company_id", "claim_date", "status");--> statement-breakpoint
CREATE INDEX "employee_claims_party_idx"
  ON "employee_claims" ("company_id", "party_id", "status");--> statement-breakpoint
CREATE INDEX "employee_claims_user_idx"
  ON "employee_claims" ("company_id", "employee_user_id", "status");--> statement-breakpoint
CREATE INDEX "employee_claims_type_idx"
  ON "employee_claims" ("company_id", "claim_type", "status");--> statement-breakpoint
CREATE INDEX "employee_claims_project_idx"
  ON "employee_claims" ("company_id", "project_id")
  WHERE "project_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "employee_claim_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "claim_id" uuid NOT NULL,
  "line_number" numeric(6,0) NOT NULL,
  "item_date" date NOT NULL,
  "category" text NOT NULL,
  -- Decision 1. NOT NULL is the whole point of this column.
  "expense_account_id" uuid NOT NULL,
  "description" text NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "receipt_filename" text,
  "receipt_url" text,
  "receipt_uploaded_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employee_claim_items_amount_positive" CHECK ("amount" > 0)
);--> statement-breakpoint

ALTER TABLE "employee_claim_items"
  ADD CONSTRAINT "employee_claim_items_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
  ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "employee_claim_items"
  ADD CONSTRAINT "employee_claim_items_claim_id_fk"
  FOREIGN KEY ("claim_id") REFERENCES "public"."employee_claims"("id")
  ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "employee_claim_items"
  ADD CONSTRAINT "employee_claim_items_expense_account_id_fk"
  FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id")
  ON DELETE restrict;--> statement-breakpoint

CREATE UNIQUE INDEX "employee_claim_items_line_unique"
  ON "employee_claim_items" ("claim_id", "line_number");--> statement-breakpoint
CREATE INDEX "employee_claim_items_claim_idx"
  ON "employee_claim_items" ("company_id", "claim_id");--> statement-breakpoint
CREATE INDEX "employee_claim_items_account_idx"
  ON "employee_claim_items" ("company_id", "expense_account_id");--> statement-breakpoint

CREATE TABLE "employee_claim_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "claim_id" uuid NOT NULL,
  "filename" text NOT NULL,
  "url" text NOT NULL,
  "public_id" text,
  "resource_type" text,
  "size" numeric(12,0),
  "mime_type" text,
  "uploaded_at" timestamp with time zone NOT NULL DEFAULT now(),
  "uploaded_by_id" text,
  "uploaded_by_name" text
);--> statement-breakpoint

ALTER TABLE "employee_claim_attachments"
  ADD CONSTRAINT "employee_claim_attachments_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
  ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "employee_claim_attachments"
  ADD CONSTRAINT "employee_claim_attachments_claim_id_fk"
  FOREIGN KEY ("claim_id") REFERENCES "public"."employee_claims"("id")
  ON DELETE cascade;--> statement-breakpoint

CREATE INDEX "employee_claim_attachments_claim_idx"
  ON "employee_claim_attachments" ("company_id", "claim_id");--> statement-breakpoint

CREATE TABLE "employee_claim_journal_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "claim_id" uuid NOT NULL,
  "journal_entry_id" uuid NOT NULL,
  "purpose" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employee_claim_journal_entries_purpose_valid" CHECK (
    "purpose" IN ('advance', 'settlement', 'return', 'expense', 'payment')
  )
);--> statement-breakpoint

ALTER TABLE "employee_claim_journal_entries"
  ADD CONSTRAINT "employee_claim_journal_entries_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
  ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "employee_claim_journal_entries"
  ADD CONSTRAINT "employee_claim_journal_entries_claim_id_fk"
  FOREIGN KEY ("claim_id") REFERENCES "public"."employee_claims"("id")
  ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "employee_claim_journal_entries"
  ADD CONSTRAINT "employee_claim_journal_entries_entry_id_fk"
  FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id")
  ON DELETE restrict;--> statement-breakpoint

CREATE UNIQUE INDEX "employee_claim_journal_entries_unique"
  ON "employee_claim_journal_entries" ("claim_id", "journal_entry_id");--> statement-breakpoint

-- Decision 3: the read-then-check that guarded double-posting, as a constraint.
CREATE UNIQUE INDEX "employee_claim_journal_entries_purpose_unique"
  ON "employee_claim_journal_entries" ("claim_id", "purpose");--> statement-breakpoint

CREATE INDEX "employee_claim_journal_entries_entry_idx"
  ON "employee_claim_journal_entries" ("company_id", "journal_entry_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- The status machine.
--
-- Transcribed from the guards scattered through claim-action.js, which each
-- protected one entry point:
--
--   claim.status !== "submitted"      approve, reject
--   claim.status !== "approved"       payAdvance, payReimbursement, closeSettlement
--   advanceClaim.status !== "paid"    settleAdvance
--   settlement.status !== "pending_return"   recordAdvanceReturn
--   settlement.status !== "pending_payment"  paySettlementBalance
--   status !== "draft" && !== "rejected"     updateClaim
--
-- Six guards in six functions, and any seventh writer skipped all of them.
-- `closed` is terminal: the money has moved both ways and the ledger has been
-- told. Nothing reopens a claim; a correction is a new one.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION employee_claim_status_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION
      'Claim % is closed and cannot be reopened. Raise a new claim.',
      OLD.claim_number
      USING ERRCODE = 'check_violation';
  END IF;

  IF (OLD.status = 'draft'      AND NEW.status = 'submitted')
     OR (OLD.status = 'submitted' AND NEW.status IN ('approved', 'rejected', 'draft'))
     OR (OLD.status = 'rejected'  AND NEW.status = 'submitted')
     -- approved splits by claim type: a request or a reimbursement is PAID,
     -- a settlement is CLOSED or lands in one of the two pending states.
     OR (OLD.status = 'approved'  AND NEW.status = 'paid'
         AND NEW.claim_type IN ('advance_request', 'reimbursement'))
     OR (OLD.status = 'approved'  AND NEW.status IN ('closed', 'pending_return', 'pending_payment')
         AND NEW.claim_type = 'advance_return')
     OR (OLD.status = 'pending_return'  AND NEW.status = 'closed')
     OR (OLD.status = 'pending_payment' AND NEW.status = 'closed')
     -- A settled advance is closed by its settlement, not by its own flow.
     OR (OLD.status = 'paid' AND NEW.status = 'closed'
         AND NEW.claim_type = 'advance_request')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'A % cannot move from % to %.',
    NEW.claim_type, OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "employee_claim_status_transition"
BEFORE UPDATE OF status ON "employee_claims"
FOR EACH ROW EXECUTE FUNCTION employee_claim_status_transition();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A settlement settles a paid advance belonging to the same person.
--
-- `settleAdvance` checks all three in application code, then writes. Two
-- concurrent settlements both pass the check; the unique index above stops the
-- second, and this stops a settlement pointed at the wrong thing entirely.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION employee_claim_settles_its_advance() RETURNS trigger AS $$
DECLARE
  adv record;
BEGIN
  IF NEW.advance_claim_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, company_id, claim_type, status, party_id, claim_number
    INTO adv
    FROM employee_claims
   WHERE id = NEW.advance_claim_id;

  IF adv.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'A settlement cannot reference an advance in another company.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF adv.claim_type <> 'advance_request' THEN
    RAISE EXCEPTION 'Claim % is a %, not an advance request.', adv.claim_number, adv.claim_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF adv.party_id <> NEW.party_id THEN
    RAISE EXCEPTION 'Advance % belongs to somebody else.', adv.claim_number
      USING ERRCODE = 'check_violation';
  END IF;

  -- Only on the way in: the advance is closed by its own settlement later, and
  -- re-checking on every subsequent update would forbid that.
  IF TG_OP = 'INSERT' AND adv.status <> 'paid' THEN
    RAISE EXCEPTION
      'Advance % has not been paid out (status %), so there is nothing to settle.',
      adv.claim_number, adv.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "employee_claim_settles_its_advance"
BEFORE INSERT OR UPDATE OF advance_claim_id, party_id ON "employee_claims"
FOR EACH ROW EXECUTE FUNCTION employee_claim_settles_its_advance();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 5: items freeze once the claim has been approved.
--
-- The total is the sum of the items and the journal entry is built from the
-- items, so editing one after approval changes what the ledger was told and
-- nothing notices. `updateClaim` refuses to run outside draft/rejected — but
-- it is one of several writers, and the others never checked.
--
-- The line is drawn at APPROVAL, not at submission, even though the app only
-- ever lets a person edit a draft. Two reasons, and the first is what the
-- tests found: `settleAdvance` creates its settlement already submitted and
-- then writes the receipts onto it, so freezing at submission makes opening a
-- settlement impossible. The second is that a submitted claim can be recalled
-- to draft and edited anyway, so nothing is actually protected there. Approval
-- is where the ledger starts caring, and it is where the database starts.
-- The draft-or-rejected rule for user EDITS still holds; it lives in
-- `updateClaim`, where the friendly message is.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION employee_claim_items_frozen() RETURNS trigger AS $$
DECLARE
  c record;
  target_claim uuid;
BEGIN
  target_claim := COALESCE(NEW.claim_id, OLD.claim_id);

  SELECT claim_number, status INTO c
    FROM employee_claims WHERE id = target_claim;

  -- The parent is on its way out; the cascade is allowed to take its items.
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF c.status NOT IN ('draft', 'rejected', 'submitted') THEN
    RAISE EXCEPTION
      'Claim % is %, so its expense items can no longer be changed.',
      c.claim_number, c.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "employee_claim_items_frozen"
BEFORE INSERT OR UPDATE OR DELETE ON "employee_claim_items"
FOR EACH ROW EXECUTE FUNCTION employee_claim_items_frozen();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A reimbursement or a settlement submitted with no receipts is not a claim.
--
-- `validateReimbursement` threw "At least one expense item is required" — from
-- `submit()` and `approve()` only. DEFERRED, because the header is inserted
-- before its items and both are one transaction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION employee_claim_requires_items() RETURNS trigger AS $$
DECLARE
  n integer;
BEGIN
  IF NEW.status = 'draft' OR NEW.claim_type = 'advance_request' THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO n FROM employee_claim_items WHERE claim_id = NEW.id;

  IF n = 0 THEN
    RAISE EXCEPTION
      'Claim % is a % with no expense items. Add at least one receipt.',
      NEW.claim_number, NEW.claim_type
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "employee_claim_requires_items"
AFTER INSERT OR UPDATE OF status ON "employee_claims"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION employee_claim_requires_items();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Neither side of a settlement may be overpaid.
--
-- balance = advance_amount - what was spent.
--   balance > 0  the employee holds cash that is not theirs, and returns it
--   balance < 0  they spent their own money, and are owed the difference
--
-- `recordAdvanceReturn` and `paySettlementBalance` each check the sign of the
-- balance and neither checks the AMOUNT against it, so a typo returns more
-- than was ever advanced and the Employee Advance account goes credit.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION employee_claim_settlement_amounts() RETURNS trigger AS $$
DECLARE
  spent numeric(19,4);
  bal   numeric(19,4);
BEGIN
  IF NEW.claim_type <> 'advance_return' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO spent
    FROM employee_claim_items WHERE claim_id = NEW.id;

  bal := NEW.advance_amount - spent;

  IF NEW.amount_returned > 0 AND NEW.amount_returned > bal THEN
    RAISE EXCEPTION
      'Claim %: cannot record a return of % against a balance of %.',
      NEW.claim_number, NEW.amount_returned, bal
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.amount_paid_to_employee > 0 AND NEW.amount_paid_to_employee > -bal THEN
    RAISE EXCEPTION
      'Claim %: cannot pay % to the employee against a balance of %.',
      NEW.claim_number, NEW.amount_paid_to_employee, bal
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "employee_claim_settlement_amounts"
BEFORE UPDATE OF amount_returned, amount_paid_to_employee ON "employee_claims"
FOR EACH ROW EXECUTE FUNCTION employee_claim_settlement_amounts();--> statement-breakpoint

-- ============================================================================
-- What a claim is worth, and what it is waiting on.
--
-- Decision 4. `totalAmount`, `totalSpent` and `balance` were stored columns
-- maintained by three `validate*` methods that ran from `submit()` and
-- `approve()` and nowhere else — so any other write left them behind. They are
-- computed here, from the items, every time they are read.
--
-- `total_amount` is the requested amount for an advance (there are no items
-- yet — that is the point of an advance) and the sum of the receipts for
-- everything else.
-- ============================================================================
CREATE VIEW "employee_claim_state" AS
SELECT c.id                                              AS claim_id,
       c.company_id,
       c.claim_type,
       c.status,
       COUNT(i.id)::integer                              AS item_count,
       COALESCE(SUM(i.amount), 0)::numeric(19,4)         AS items_total,
       CASE c.claim_type
         WHEN 'advance_request' THEN COALESCE(c.requested_amount, 0)
         ELSE COALESCE(SUM(i.amount), 0)
       END::numeric(19,4)                                AS total_amount,
       -- Only a settlement has these; NULL says "not applicable" rather than
       -- "zero", which is the distinction 0051 drew for affected_value.
       CASE WHEN c.claim_type = 'advance_return'
            THEN COALESCE(SUM(i.amount), 0)::numeric(19,4)
       END                                               AS total_spent,
       CASE WHEN c.claim_type = 'advance_return'
            THEN (c.advance_amount - COALESCE(SUM(i.amount), 0))::numeric(19,4)
       END                                               AS balance,
       -- What is still outstanding on a settlement, after any cash already
       -- moved. Positive: the employee still owes. Negative: still owed.
       CASE WHEN c.claim_type = 'advance_return'
            THEN (c.advance_amount - COALESCE(SUM(i.amount), 0)
                  - c.amount_returned + c.amount_paid_to_employee)::numeric(19,4)
       END                                               AS balance_outstanding,
       -- What actually left the bank on an advance, rather than what was asked
       -- for. Null until it is paid.
       CASE WHEN c.claim_type = 'advance_request' AND c.paid_at IS NOT NULL
            THEN COALESCE(c.requested_amount, 0)::numeric(19,4)
       END                                               AS disbursed_amount,
       -- What the flow is waiting for, rather than what happened last.
       CASE c.status
         WHEN 'draft'           THEN 'awaiting submission'
         WHEN 'submitted'       THEN 'awaiting approval'
         WHEN 'rejected'        THEN 'awaiting correction'
         WHEN 'approved'        THEN CASE c.claim_type
                                       WHEN 'advance_return' THEN 'awaiting settlement'
                                       ELSE 'awaiting payment'
                                     END
         WHEN 'paid'            THEN CASE c.claim_type
                                       WHEN 'advance_request' THEN 'awaiting settlement'
                                       ELSE NULL
                                     END
         WHEN 'pending_return'  THEN 'awaiting cash back from employee'
         WHEN 'pending_payment' THEN 'awaiting payment to employee'
         ELSE NULL
       END                                               AS awaiting
  FROM employee_claims c
  LEFT JOIN employee_claim_items i ON i.claim_id = c.id
 GROUP BY c.id, c.company_id, c.claim_type, c.status, c.requested_amount,
          c.advance_amount, c.amount_returned, c.amount_paid_to_employee,
          c.paid_at;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security. The one rule: nothing here writes a company_id filter.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employee_claims',
    'employee_claim_items',
    'employee_claim_attachments',
    'employee_claim_journal_entries'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_claims" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_claim_items" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_claim_attachments" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_claim_journal_entries" TO app_user;--> statement-breakpoint
GRANT SELECT ON "employee_claim_state" TO app_user;

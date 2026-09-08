-- ─────────────────────────────────────────────────────────────────────────────
-- 0101 — The approval engine.
--
-- The last cross-cutting Mongo module, and the only one that was genuinely
-- WORKING rather than stranded. The wire ran:
--
--   a Postgres action (expense, payment, product, adjustment)
--     -> submitApproval()            writes a MONGO ApprovalRequest
--       -> the approvals page         reads MONGO
--         -> approveApproval()        claims the MONGO lease
--           -> applyStockAdjustment() applies back into POSTGRES
--
-- Both ends knew where the middle lived, so it worked. What it cost is that
-- POSTGRES MONEY PATHS CANNOT RUN WITHOUT MONGO. `requestApprovalIfOverThreshold`
-- is awaited inside `expense-actions.ts` and `payment-actions.ts`, so on a
-- deployment without a Mongo connection, paying an expense over the threshold
-- does not skip the approval — it THROWS. `expense_payment_value` defaults to
-- 50,000 and is set for every company.
--
-- That is why this is the migration that unblocks a Postgres-only deploy, and
-- it is the reason it comes before integrations despite being smaller.
--
-- ── What is NOT in this migration ─────────────────────────────────────────
--
-- The appliers. Every one of them already reaches into Postgres —
-- `applyApprovedStockAdjustmentPg`, `releaseApprovedPaymentPg`,
-- `applyApprovedPriceChangePg`, the expense release, the credit note. They
-- were ported one at a time as each module moved, and the notes above them
-- record what each was posting into the Mongo ledger before it. Only the
-- REQUEST DOCUMENT is left, which is what this table is.
--
-- ── Decision 1 — THE LEASE IS A CONDITIONAL UPDATE ────────────────────────
--
-- Mongo's engine claims a request with `findOneAndUpdate({status:'submitted'},
-- {$set:{status:'applying'}})` — an atomic compare-and-set so two approvers
-- clicking together cannot both apply the payload. The comment on the model
-- explains it at length because in Mongo it needed explaining.
--
-- Here it is `UPDATE ... WHERE status = 'submitted' RETURNING id`. Zero rows
-- means somebody else won. That is the same guarantee with nothing special
-- about it, which is the point.
--
-- ── Decision 2 — THE STALE LEASE IS A PARTIAL INDEX, STILL ────────────────
--
-- If the process dies between claiming and finalising, a request is stuck in
-- 'applying' — invisible to a queue that lists 'submitted', and impossible to
-- act on. `/api/cron/reap-approvals` sweeps them. Mongo indexed `updatedAt`
-- with a partial filter on that status; the same index, for the same sweep.
--
-- ── Decision 3 — THE DECISION IS A PAIR, AND THE DATABASE SAYS SO ─────────
--
-- Mongo's `decision` was a free-floating sub-document that a status change was
-- not obliged to set, so 'approved' with no approver and no timestamp was a
-- reachable row — in the audit record of who authorised money moving. Here a
-- decided request carries its decision and an undecided one carries none.
--
-- ── Decision 4 — targetRef.id IS text, DELIBERATELY ───────────────────────
--
-- It points at a Product, an adjustment, a payment, an expense or a credit
-- note, in two different stores, so it can be a uuid or a 24-character
-- ObjectId. The Mongo schema learned this the hard way: it was typed
-- `Schema.Types.ObjectId` and threw a CastError on every approval raised
-- against a Postgres row — its own comment records that expense payments over
-- fifty thousand shillings threw instead of going for sign-off. Text, with no
-- foreign key, and the migration says so rather than papering over it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "approval_type" AS ENUM (
  'price_change',
  'stock_writeoff',
  'stock_adjustment',
  'bill_payment',
  'expense_payment',
  'credit_note',
  'discount'
);--> statement-breakpoint

CREATE TYPE "approval_status" AS ENUM (
  'submitted',
  'applying',
  'approved',
  'rejected',
  'cancelled'
);--> statement-breakpoint

CREATE TYPE "approval_target_kind" AS ENUM (
  'Product',
  'InventoryAdjustment',
  'StockAdjustment',
  'Bill',
  'Invoice',
  'CreditNote',
  'Payment',
  'Expense'
);--> statement-breakpoint

CREATE TABLE "approval_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,

  "request_number" text NOT NULL,
  "type" "approval_type" NOT NULL,
  "status" "approval_status" DEFAULT 'submitted' NOT NULL,

  /* Decision 4 — two stores, so text and no key. */
  "target_kind" "approval_target_kind" NOT NULL,
  "target_id" text NOT NULL,
  /* A snapshot, so the queue reads after the target is renamed or deleted. */
  "target_label" text,

  /* The proposed new state. Type-specific, read by the applier on approval. */
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  /* What tripped the threshold, captured at submission for later audit. */
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,

  "reason" text DEFAULT '' NOT NULL,
  "requester_note" text DEFAULT '' NOT NULL,

  /* Who may decide it — roles, from the matrix, frozen at submission so a
     later change to the matrix cannot retroactively widen an open request. */
  "required_approver_roles" text[] DEFAULT '{}'::text[] NOT NULL,

  "submitted_by_id" text NOT NULL,
  "submitted_by_name" text NOT NULL,
  "submitted_by_role" text,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,

  /* Decision 3 — set together or not at all. */
  "decision_action" "approval_status",
  "decided_by_id" text,
  "decided_by_name" text,
  "decided_by_role" text,
  "decided_at" timestamp with time zone,
  "decision_note" text,

  /* What the applier produced, for audit. Not every type produces one. */
  "applied_at" timestamp with time zone,
  "applied_kind" text,
  "applied_id" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "approval_requests_company_number_uq"
    UNIQUE ("company_id", "request_number"),

  CONSTRAINT "approval_requests_target_id_not_blank"
    CHECK (length(btrim("target_id")) > 0),

  /* Decision 3. A terminal state carries its decision; anything still open
     carries none. 'applying' is mid-flight and has not decided either. */
  CONSTRAINT "approval_requests_decision_pair" CHECK (
    CASE WHEN "status" IN ('approved', 'rejected', 'cancelled')
         THEN "decision_action" IS NOT NULL
              AND "decided_at" IS NOT NULL
              AND "decided_by_name" IS NOT NULL
         ELSE "decision_action" IS NULL
              AND "decided_at" IS NULL
    END
  ),

  /* And it recorded the decision it actually reached. */
  CONSTRAINT "approval_requests_decision_matches_status" CHECK (
    "decision_action" IS NULL OR "decision_action" = "status"
  ),

  /* Only an approved request has been applied. A rejected one applied
     nothing — that is what rejecting it means. */
  CONSTRAINT "approval_requests_applied_only_when_approved" CHECK (
    "applied_at" IS NULL OR "status" = 'approved'
  ),
  CONSTRAINT "approval_requests_applied_pair" CHECK (
    ("applied_kind" IS NULL) = ("applied_id" IS NULL)
  ),

  /* An open request that nobody is allowed to decide is a dead letter. */
  CONSTRAINT "approval_requests_has_approvers" CHECK (
    cardinality("required_approver_roles") > 0
  )
);--> statement-breakpoint

/* "What is waiting for a decision", newest first — the queue. */
CREATE INDEX "approval_requests_queue_idx"
  ON "approval_requests" ("company_id", "status", "created_at" DESC);--> statement-breakpoint

/* "What is waiting that I may decide" filters the queue by type. */
CREATE INDEX "approval_requests_type_idx"
  ON "approval_requests" ("company_id", "type", "status");--> statement-breakpoint

/* "What did I submit". */
CREATE INDEX "approval_requests_submitter_idx"
  ON "approval_requests" ("company_id", "submitted_by_id", "status");--> statement-breakpoint

/* Finding the request that is holding a given document. */
CREATE INDEX "approval_requests_target_idx"
  ON "approval_requests" ("company_id", "target_kind", "target_id");--> statement-breakpoint

/*
 * Decision 2 — the reaper's index. Partial, because 'applying' is a tiny and
 * short-lived set: a healthy apply takes seconds, and only a crash between
 * the claim and the finalise leaves one behind.
 */
CREATE INDEX "approval_requests_stale_lease_idx"
  ON "approval_requests" ("updated_at")
  WHERE "status" = 'applying';--> statement-breakpoint

ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "approval_requests"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

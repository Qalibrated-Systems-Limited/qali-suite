-- ============================================================================
-- 0031 — A user id is not a UUID, and these columns were never a reference.
--
-- Every ported write action failed in production. auth.ts sets
-- `session.user.id = dbUser._id.toString()` — a 24-character Mongo ObjectId —
-- and 48 columns typed it `uuid`, so the first real click produced:
--
--     invalid input syntax for type uuid: "507f1f77bcf86cd799439011"
--
-- on createInvoicePg, createBill, submitBill, approveBill, postJournalEntry,
-- issueCreditNote and every other write. Nineteen call sites.
--
-- The tests did not catch it because every one of them mocks the session with
-- randomUUID(), so the fixture was the only thing in the system that satisfied
-- the column type. A test double that is more correct than production is a
-- test that cannot fail — tests/pg-real-session.test.mjs now uses the id shape
-- auth.ts actually issues, and asserts it end to end for each write path.
--
-- ---------------------------------------------------------------------------
-- WHY text, AND NOT A MAPPING.
--
-- Measured before choosing: of 48 identity-named columns across 17 tables,
-- exactly ONE carries a foreign key — stock_movements.issued_to_id, which
-- references `parties` and is not a user at all. It keeps its uuid. The other
-- 47 reference nothing, because `users` is not ported (§10) and there is no
-- users table to point at.
--
-- A `uuid` type on a column with no FK asserts membership of an id space that
-- does not exist here. What these columns actually hold is "whoever the
-- identity provider says did this", and today that is an ObjectId.
--
-- (A first pass at this counted zero foreign keys, because it looked for them
-- in information_schema.key_column_usage joined on column name alone. The
-- ALTER on issued_to_id is what corrected it — pg_constraint is the answer.)
--
-- The alternative was to map user ids through `_migration_id_map`, the way
-- company ids are. That is ruled out by 0023/0024 rather than by taste: the
-- application role holds SELECT on that table and nothing else, deliberately,
-- because only the backfill writes it. Allocating a mapping on a user's first
-- write would mean a privileged connection on an ordinary request path.
--
-- What this gives up is a free foreign key on a future `users` table. That is
-- a conversion at the point users are actually ported, with the map available,
-- and it is a smaller cost than every write being broken now.
--
-- The rendered value does not depend on any of this: 0026 and 0029 snapshot
-- the actor's NAME beside the id for exactly this reason, so a page shows who
-- acted whether or not the id resolves to anything.
--
-- outstanding_checkouts selects checked_out_to_id, so it is dropped and
-- recreated around the change — the definition is unchanged.
-- ============================================================================

DROP VIEW IF EXISTS "outstanding_checkouts";--> statement-breakpoint

ALTER TABLE "accounts" ALTER COLUMN "created_by_id" SET DATA TYPE text USING "created_by_id"::text;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "last_modified_by_id" SET DATA TYPE text USING "last_modified_by_id"::text;--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "approved_by_id" SET DATA TYPE text USING "approved_by_id"::text;--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "cancelled_by_id" SET DATA TYPE text USING "cancelled_by_id"::text;--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "created_by_id" SET DATA TYPE text USING "created_by_id"::text;--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "rejected_by_id" SET DATA TYPE text USING "rejected_by_id"::text;--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "submitted_by_id" SET DATA TYPE text USING "submitted_by_id"::text;--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "created_by_id" SET DATA TYPE text USING "created_by_id"::text;--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "issued_by_id" SET DATA TYPE text USING "issued_by_id"::text;--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "voided_by_id" SET DATA TYPE text USING "voided_by_id"::text;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ALTER COLUMN "closed_by_id" SET DATA TYPE text USING "closed_by_id"::text;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ALTER COLUMN "locked_by_id" SET DATA TYPE text USING "locked_by_id"::text;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "cancelled_by_id" SET DATA TYPE text USING "cancelled_by_id"::text;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "completed_by_id" SET DATA TYPE text USING "completed_by_id"::text;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "created_by_id" SET DATA TYPE text USING "created_by_id"::text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ALTER COLUMN "checked_out_by_id" SET DATA TYPE text USING "checked_out_by_id"::text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ALTER COLUMN "checked_out_to_id" SET DATA TYPE text USING "checked_out_to_id"::text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ALTER COLUMN "escalated_to_id" SET DATA TYPE text USING "escalated_to_id"::text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ALTER COLUMN "expensed_by_id" SET DATA TYPE text USING "expensed_by_id"::text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ALTER COLUMN "return_required_by_id" SET DATA TYPE text USING "return_required_by_id"::text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ALTER COLUMN "returned_by_id" SET DATA TYPE text USING "returned_by_id"::text;--> statement-breakpoint
ALTER TABLE "item_checkouts" ALTER COLUMN "sale_converted_by_id" SET DATA TYPE text USING "sale_converted_by_id"::text;--> statement-breakpoint
ALTER TABLE "journal_entries" ALTER COLUMN "created_by_id" SET DATA TYPE text USING "created_by_id"::text;--> statement-breakpoint
ALTER TABLE "journal_entries" ALTER COLUMN "last_modified_by_id" SET DATA TYPE text USING "last_modified_by_id"::text;--> statement-breakpoint
ALTER TABLE "journal_entries" ALTER COLUMN "posted_by_id" SET DATA TYPE text USING "posted_by_id"::text;--> statement-breakpoint
ALTER TABLE "journal_entries" ALTER COLUMN "reversed_by_id" SET DATA TYPE text USING "reversed_by_id"::text;--> statement-breakpoint
ALTER TABLE "parties" ALTER COLUMN "created_by_id" SET DATA TYPE text USING "created_by_id"::text;--> statement-breakpoint
ALTER TABLE "parties" ALTER COLUMN "last_modified_by_id" SET DATA TYPE text USING "last_modified_by_id"::text;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "cancelled_by_id" SET DATA TYPE text USING "cancelled_by_id"::text;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "confirmed_by_id" SET DATA TYPE text USING "confirmed_by_id"::text;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "created_by_id" SET DATA TYPE text USING "created_by_id"::text;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "created_by_id" SET DATA TYPE text USING "created_by_id"::text;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "last_modified_by_id" SET DATA TYPE text USING "last_modified_by_id"::text;--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "performed_by_id" SET DATA TYPE text USING "performed_by_id"::text;--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "reversed_by_id" SET DATA TYPE text USING "reversed_by_id"::text;--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "verified_by_id" SET DATA TYPE text USING "verified_by_id"::text;--> statement-breakpoint
ALTER TABLE "stock_request_approvals" ALTER COLUMN "approver_id" SET DATA TYPE text USING "approver_id"::text;--> statement-breakpoint
ALTER TABLE "stock_request_fulfilments" ALTER COLUMN "fulfilled_by_id" SET DATA TYPE text USING "fulfilled_by_id"::text;--> statement-breakpoint
ALTER TABLE "stock_requests" ALTER COLUMN "approved_by_id" SET DATA TYPE text USING "approved_by_id"::text;--> statement-breakpoint
ALTER TABLE "stock_requests" ALTER COLUMN "created_by_id" SET DATA TYPE text USING "created_by_id"::text;--> statement-breakpoint
ALTER TABLE "stock_requests" ALTER COLUMN "rejected_by_id" SET DATA TYPE text USING "rejected_by_id"::text;--> statement-breakpoint
ALTER TABLE "stock_requests" ALTER COLUMN "requester_id" SET DATA TYPE text USING "requester_id"::text;--> statement-breakpoint
ALTER TABLE "tax_transactions" ALTER COLUMN "created_by_id" SET DATA TYPE text USING "created_by_id"::text;--> statement-breakpoint
ALTER TABLE "tax_transactions" ALTER COLUMN "filed_by_id" SET DATA TYPE text USING "filed_by_id"::text;--> statement-breakpoint
ALTER TABLE "tax_transactions" ALTER COLUMN "reconciled_by_id" SET DATA TYPE text USING "reconciled_by_id"::text;--> statement-breakpoint
ALTER TABLE "tax_transactions" ALTER COLUMN "remitted_by_id" SET DATA TYPE text USING "remitted_by_id"::text;--> statement-breakpoint
ALTER TABLE "weighbridge_tickets" ALTER COLUMN "voided_by_id" SET DATA TYPE text USING "voided_by_id"::text;--> statement-breakpoint

CREATE VIEW "outstanding_checkouts" AS
  SELECT company_id,
         id AS checkout_id,
         checkout_number,
         product_id,
         product_name_at_checkout,
         checked_out_to_id,
         checked_out_to_name_at_checkout,
         quantity,
         (((quantity - quantity_sold) - quantity_returned) - quantity_expensed)
           AS quantity_outstanding,
         checked_out_at,
         expected_return_date,
         GREATEST(0, (CURRENT_DATE - expected_return_date)) AS days_overdue,
         return_required,
         return_deadline,
         status
    FROM item_checkouts c
   WHERE status = ANY (ARRAY['checked_out'::checkout_status, 'overdue'::checkout_status]);

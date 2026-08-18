-- ============================================================================
-- 0026 — Who raised the invoice, as they were named then.
--
-- Found wiring the invoice detail page, which renders invoice.createdBy.name
-- and .role. Postgres stored created_by_id and nothing else, and there is no
-- users table to join to — users are still in Mongo and are not in scope (§10).
-- So the field was simply unrenderable.
--
-- The pattern is already established for exactly this reason elsewhere in the
-- schema: item_checkouts.checked_out_by_name_at_checkout,
-- stock_requests.requester_name_at_request,
-- bills.supplier_name_at_bill, credit_notes.customer_name_at_issue. Where a
-- person or party acted, the name is snapshotted alongside the id, because a
-- rename must not relabel what already happened (§9.4). Invoices and journal
-- entries were the omission, not the rule.
--
-- Nullable: existing rows predate the column and cannot be reconstructed.
-- ============================================================================

ALTER TABLE "invoices" ADD COLUMN "created_by_name" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "created_by_role" text;

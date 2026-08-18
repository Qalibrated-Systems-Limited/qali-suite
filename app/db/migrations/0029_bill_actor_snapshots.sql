-- ============================================================================
-- 0029 — Who acted on the bill, as they were named then.
--
-- Found wiring the bill detail page, which renders bill.createdBy.name,
-- bill.rejectedBy.name and bill.cancelledBy.name. Bills stored created_by_id,
-- submitted_by_id, approved_by_id, rejected_by_id and cancelled_by_id and
-- nothing else, and there is no users table to join to — users are still in
-- Mongo and are not in scope (§10). So every one of those fields was
-- unrenderable.
--
-- Exactly what 0026 found on invoices, and the same call this table already
-- makes for the supplier in supplier_name_at_bill: where a person acted, the
-- name is snapshotted alongside the id, because a rename must not relabel what
-- already happened (§9.4). The role is carried for the creator only, which is
-- the one the page shows.
--
-- All nullable: existing rows predate the columns and cannot be reconstructed.
--
-- ---------------------------------------------------------------------------
-- A NOTE ON THE GENERATED FILE THIS REPLACES.
--
-- `drizzle-kit generate` emitted the invoice-lines service split (0025), the
-- invoice creator snapshot (0026) and the COGS entry link (0027) alongside
-- these columns, because meta/0025..0028_snapshot.json were never regenerated
-- when those four migrations were hand-written — every one is still a copy of
-- 0024's state, so the diff baseline was five migrations stale and re-emitted
-- work the database already has.
--
-- Only this migration's own change is kept here. meta/0029_snapshot.json IS
-- the true current schema (it is derived from app/db/schema, which carries all
-- of it), so the next `db:generate` diffs against reality rather than against
-- 0024. The stale snapshots behind it are left as they are: rewriting the
-- meta history of applied migrations would be a bigger and riskier change than
-- the drift it corrects.
-- ============================================================================

ALTER TABLE "bills" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "created_by_role" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "submitted_by_name" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "approved_by_name" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "rejected_by_name" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "cancelled_by_name" text;

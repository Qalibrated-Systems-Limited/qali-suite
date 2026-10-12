-- ============================================================================
-- A GOODS RECEIPT NAMES A SUPPLIER THAT EXISTS — 0122
--
-- `goods_receipts.supplier_id` has always carried a real foreign key, and a
-- good one: `(supplier_id, company_id) REFERENCES parties(id, company_id)`, so
-- one tenant's supplier cannot be attached to another tenant's receipt. The
-- problem was never referential integrity. It was that both columns are
-- nullable and the form only ever filled the NAME.
--
-- `supplierPartyId` reached the payload solely as a side effect of choosing a
-- purchase order or a bill — the picker copies it off the chosen document.
-- There is no supplier control on the form at all, so an UNSCHEDULED receipt —
-- the walk-in delivery, the one with no PO and no bill behind it — got a typed
-- string and `supplier_id = NULL`.
--
-- WHAT A NULL SUPPLIER COSTS, and none of it is cosmetic:
--
--   the ledger    `partyType: grn.supplierId ? "supplier" : null` — so the
--                 acceptance entry posts with NO PARTY, and the GR/IR credit
--                 it raises is attributable to nobody. On the reconciliation
--                 screen that position has no supplier to chase it by.
--   the filters   `listGoodsReceipts` filters on `grn.supplier_id`, so a
--                 receipt with only a name is invisible to a search for the
--                 supplier whose name it carries.
--   the links     the detail page builds `{ partyId, _id, name }` from the
--                 same column, so the link through to the supplier record is
--                 dead and only the text renders.
--
-- Bills got this right and are the model: `supplier_id NOT NULL`,
-- `supplier_name_at_bill NOT NULL`, indexed, ON DELETE RESTRICT.
--
-- TWO CONSTRAINTS RATHER THAN ONE CLEVER CASE, because they say two different
-- things and should fail with two different messages.
--
-- The name is required ALWAYS — it is the snapshot, the record of what the
-- supplier was called on the day, and the reason it survives a later rename.
-- The id is required unless the receipt is unscheduled, because a purchase
-- order and a bill both carry a supplier already (`purchase_orders.supplier_id`
-- and `bills.supplier_id` are both NOT NULL), so a receipt derived from either
-- has no excuse for losing it.
--
-- Unscheduled is left able to stand on the name alone, deliberately: goods do
-- arrive from somebody not yet on file, and refusing the receipt outright
-- would leave the storekeeper holding stock they cannot book in. The form now
-- offers to create the party instead, so this is the fallback and not the
-- path — and the pairing below means the fallback at least records a name.
--
-- Safe to apply: there are no goods receipts on this deployment yet, which is
-- precisely why it is worth doing now rather than after a year of them.
-- ============================================================================

ALTER TABLE "goods_receipts"
  DROP CONSTRAINT IF EXISTS "goods_receipts_supplier_name_present";--> statement-breakpoint

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_supplier_name_present"
  CHECK ("supplier_name" IS NOT NULL AND btrim("supplier_name") <> '');--> statement-breakpoint

ALTER TABLE "goods_receipts"
  DROP CONSTRAINT IF EXISTS "goods_receipts_supplier_linked_unless_unscheduled";--> statement-breakpoint

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_supplier_linked_unless_unscheduled"
  CHECK ("source_type" = 'unscheduled' OR "supplier_id" IS NOT NULL);--> statement-breakpoint

-- The index bills already have. `listGoodsReceipts` filters on this column and
-- the reconciliation screen groups by supplier; neither had anything to use.
CREATE INDEX IF NOT EXISTS "goods_receipts_company_supplier_idx"
  ON "goods_receipts" ("company_id", "supplier_id");--> statement-breakpoint

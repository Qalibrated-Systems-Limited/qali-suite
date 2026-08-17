-- ============================================================================
-- 0014 — Stock movements: tenant-composite keys, immutability, snapshots, the
-- COGS provenance chain, and RLS.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tenant-composite foreign keys.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_tenant_fk"
  FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "stock_movements" DROP CONSTRAINT IF EXISTS "stock_movements_invoice_line_id_invoice_lines_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_invoice_line_tenant_fk"
  FOREIGN KEY ("invoice_line_id", "company_id") REFERENCES "invoice_lines"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Snapshots. What the product and the people were called when stock moved.
--    Filled on insert so they cannot be forgotten; a rename must not relabel a
--    movement that already happened.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_snapshot_movement_names() RETURNS trigger AS $$
BEGIN
  IF COALESCE(NEW.product_sku_at_movement, '') = ''
     OR COALESCE(NEW.product_name_at_movement, '') = '' THEN
    SELECT p.sku, p.name
      INTO NEW.product_sku_at_movement, NEW.product_name_at_movement
      FROM products p WHERE p.id = NEW.product_id;
  END IF;

  IF NEW.issued_to_id IS NOT NULL
     AND COALESCE(NEW.issued_to_name_at_movement, '') = '' THEN
    SELECT pa.name INTO NEW.issued_to_name_at_movement
      FROM parties pa WHERE pa.id = NEW.issued_to_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER stock_movements_snapshot_names
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION trg_snapshot_movement_names();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. IMMUTABILITY — carried over from the Mongo model, not invented here.
--
--    stockmovement.js rejects any change outside a short allow-list with
--    "Stock movements are immutable. Create a reversal instead." That rule is
--    right: a movement records a physical event that either happened or did
--    not. But a Mongoose pre-save hook only fires on document.save(), so
--    updateOne / findByIdAndUpdate / bulkWrite bypass it entirely.
--
--    Here the same allow-list is enforced by the database, so no write path can
--    avoid it.
--
--    Mutable: accounting links, verification, return date, status, reversal.
--    Frozen: product, quantity, direction, costing, stock levels, provenance.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_stock_movement_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.product_id                 IS DISTINCT FROM OLD.product_id
     OR NEW.movement_type           IS DISTINCT FROM OLD.movement_type
     OR NEW.direction               IS DISTINCT FROM OLD.direction
     OR NEW.quantity                IS DISTINCT FROM OLD.quantity
     OR NEW.previous_stock          IS DISTINCT FROM OLD.previous_stock
     OR NEW.new_stock               IS DISTINCT FROM OLD.new_stock
     OR NEW.unit_cost               IS DISTINCT FROM OLD.unit_cost
     OR NEW.total_cost              IS DISTINCT FROM OLD.total_cost
     OR NEW.average_cost_at_movement IS DISTINCT FROM OLD.average_cost_at_movement
     OR NEW.invoice_line_id         IS DISTINCT FROM OLD.invoice_line_id
     OR NEW.movement_number         IS DISTINCT FROM OLD.movement_number
     OR NEW.movement_date           IS DISTINCT FROM OLD.movement_date
     OR NEW.product_sku_at_movement IS DISTINCT FROM OLD.product_sku_at_movement
     OR NEW.product_name_at_movement IS DISTINCT FROM OLD.product_name_at_movement
  THEN
    RAISE EXCEPTION
      'Stock movement % is immutable. Create a reversal instead.',
      OLD.movement_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER stock_movements_are_immutable
  BEFORE UPDATE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION trg_stock_movement_immutable();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. COGS PROVENANCE — the chain, end to end.
--
--    cogs_postings already records what a sale cost, who costed it, and on what
--    quantity. This joins it to the stock that physically moved, so the
--    question "why is cost of sales 47.50 on this line?" has a documented
--    answer rather than "the system says so".
--
--    A quantity mismatch between what was costed and what moved is surfaced as
--    a column, not hidden: a weighbridge line costed at the weighed 9.75 while
--    10 was issued is a real discrepancy someone should see.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "cogs_provenance" WITH (security_invoker = true) AS
SELECT
  il.id                    AS invoice_line_id,
  il.company_id,
  i.invoice_number,
  il.line_number,
  il.fulfilment_source,
  p.sku                    AS product_sku,
  il.quantity              AS quantity_invoiced,
  cp.quantity              AS quantity_costed,
  cp.posted_by             AS costed_by,
  cp.unit_cost,
  cp.total_cost,
  cp.journal_entry_id      AS cogs_entry_id,
  sm.movement_number,
  sm.quantity              AS quantity_moved,
  sm.movement_date,
  -- Anything non-zero here means the books and the warehouse disagree.
  (COALESCE(cp.quantity, 0) - COALESCE(sm.quantity, 0))::numeric(19,4)
                           AS costed_vs_moved_variance
FROM invoice_lines il
JOIN invoices i        ON i.id = il.invoice_id
JOIN products p        ON p.id = il.product_id
LEFT JOIN cogs_postings cp ON cp.invoice_line_id = il.id
LEFT JOIN stock_movements sm ON sm.invoice_line_id = il.id
                            AND sm.status <> 'reversed';
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stock_movements"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

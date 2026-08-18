-- ============================================================================
-- 0025 — Invoice lines can be services.
--
-- Found while extending the backfill past the accounting core, which is the
-- point of doing the backfill: it forces every field of every source document
-- through the target schema, and this one did not fit.
--
-- app/models/invoice.js has always had:
--
--     itemType: { enum: ["product", "service"], required: true }
--     serviceCategory: { enum: ["labor", "mileage", "accommodation",
--                               "installation", "consultation",
--                               "maintenance", "repair", "other"] }
--     productId: { ref: "Product" }   // "Required if itemType is product"
--
-- and it is a live feature, not a vestige — opportunity-actions.js:92 creates
-- `itemType: "service"`, and EditInvoiceForm.jsx exposes it. An ERP that bills
-- installation, repair, labour and mileage will have a great many such lines.
--
-- invoice_lines (migration 0007) had `product_id NOT NULL` and no item type at
-- all. So no invoice containing a service line could be represented, and the
-- backfill would have had to quarantine every one of them.
--
-- The asymmetry is the tell: credit_note_lines has carried item_type and a
-- nullable product_id since 0015, with exactly the CHECK added below. A service
-- line was expressible on the credit note that REVERSES a sale but not on the
-- invoice that MAKES it.
-- ============================================================================

CREATE TYPE "public"."line_item_type" AS ENUM('product', 'service');
--> statement-breakpoint

CREATE TYPE "public"."service_category" AS ENUM(
  'labor', 'mileage', 'accommodation', 'installation',
  'consultation', 'maintenance', 'repair', 'other'
);
--> statement-breakpoint

-- Existing rows are all products: the column they would need to be anything
-- else was mandatory until now.
ALTER TABLE "invoice_lines"
  ADD COLUMN "item_type" "line_item_type" DEFAULT 'product' NOT NULL;
--> statement-breakpoint

ALTER TABLE "invoice_lines" ADD COLUMN "service_category" "service_category";
--> statement-breakpoint

-- bill_lines and credit_note_lines both carry a unit; this did not, and a
-- service is billed in hours or kilometres rather than in pieces.
ALTER TABLE "invoice_lines" ADD COLUMN "unit" text DEFAULT 'pcs' NOT NULL;
--> statement-breakpoint

ALTER TABLE "invoice_lines" ALTER COLUMN "product_id" DROP NOT NULL;
--> statement-breakpoint

-- A product line names a product; a service line does not. Same rule
-- credit_note_lines has enforced since 0015.
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_matches_item_type"
  CHECK ((item_type = 'product') = (product_id IS NOT NULL));
--> statement-breakpoint

-- A service category belongs only to a service.
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_service_category_scope"
  CHECK (service_category IS NULL OR item_type = 'service');
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- COGS does not apply to a service.
--
-- cogs_postings exists to record what a sale cost, and a service has no
-- inventory cost — invoice.js only costs product items. Nothing enforced that,
-- and a COGS row against a service line would silently overstate cost of sales.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_cogs_only_for_products() RETURNS trigger AS $$
DECLARE
  v_type text;
BEGIN
  SELECT item_type::text INTO v_type
    FROM invoice_lines WHERE id = NEW.invoice_line_id;

  IF v_type = 'service' THEN
    RAISE EXCEPTION
      'Cannot post COGS against a service line: a service has no inventory cost'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER cogs_postings_products_only
  BEFORE INSERT OR UPDATE ON cogs_postings
  FOR EACH ROW EXECUTE FUNCTION trg_cogs_only_for_products();

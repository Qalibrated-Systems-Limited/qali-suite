-- ============================================================================
-- 0008 — Invoices slice: tenant-composite foreign keys, the fulfilment-source
-- invariant (§8.1), derived stock availability (§8.4), and RLS.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Composite keys, so every reference carries the tenant with it.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "products"      ADD CONSTRAINT "products_id_company_uq"      UNIQUE ("id", "company_id");
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_id_company_uq" UNIQUE ("id", "company_id");
--> statement-breakpoint

-- Customer must be a party of THIS company.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_tenant_fk"
  FOREIGN KEY ("customer_id", "company_id") REFERENCES "parties"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_tenant_fk"
  FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id")
  ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "invoice_lines" DROP CONSTRAINT IF EXISTS "invoice_lines_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_tenant_fk"
  FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- Fulfilment references, each tenant-scoped.
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_stock_request_tenant_fk"
  FOREIGN KEY ("stock_request_id", "company_id") REFERENCES "stock_requests"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_checkout_tenant_fk"
  FOREIGN KEY ("checkout_id", "company_id") REFERENCES "item_checkouts"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_weighbridge_tenant_fk"
  FOREIGN KEY ("weighbridge_ticket_id", "company_id") REFERENCES "weighbridge_tickets"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "cogs_postings" ADD CONSTRAINT "cogs_postings_line_tenant_fk"
  FOREIGN KEY ("invoice_line_id", "company_id") REFERENCES "invoice_lines"("id", "company_id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. §8.1 — a line's fulfilment source must be exactly one thing.
--
--    Invoice.complete() currently decides which inventory account COGS credits
--    from whether a nullable nested field happens to exist:
--
--      const isFromTechnicianStock =
--        !!(item.relatedRequest?.requestId || item.relatedCheckout?.checkoutId);
--      const isWBFulfilled = !!item.weighbridgeTicketId;
--
--    So "sold from main inventory" and "the relatedRequest field did not
--    persist" are the same state, and nothing stops two sources being set at
--    once — the if/else-if silently prefers technician stock, making precedence
--    a function of statement order.
--
--    With this constraint the ambiguous states cannot be stored, so the
--    precedence question stops existing and a missing reference is a write-time
--    error rather than a silent switch to a different GL account.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_fulfilment_source_consistent" CHECK (
     (fulfilment_source = 'inventory'
        AND stock_request_id IS NULL
        AND checkout_id IS NULL
        AND weighbridge_ticket_id IS NULL)
  OR (fulfilment_source = 'stock_request'
        AND stock_request_id IS NOT NULL
        AND checkout_id IS NULL
        AND weighbridge_ticket_id IS NULL)
  OR (fulfilment_source = 'checkout'
        AND checkout_id IS NOT NULL
        AND stock_request_id IS NULL
        AND weighbridge_ticket_id IS NULL)
  OR (fulfilment_source = 'weighbridge'
        AND weighbridge_ticket_id IS NOT NULL
        AND stock_request_id IS NULL
        AND checkout_id IS NULL)
);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. §8.4 — available stock is computed, never stored.
--
--    app/models/product.js documents quantityAvailable as
--    "= quantityOnHand - quantityCommitted - quantityOnHold" and then stores
--    the result, so it can disagree with the three columns that define it. A
--    generated column cannot.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "products"
  ADD COLUMN "quantity_available" numeric(19,4)
  GENERATED ALWAYS AS (quantity_on_hand - quantity_committed - quantity_on_hold) STORED;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. §8.2 — header provenance is DERIVED from the lines, not stored.
--
--    Mongo keeps invoice.source.type alongside per-line relatedRequest /
--    relatedCheckout with nothing reconciling them, so an invoice can read
--    "direct" while its lines post against Technician Stock. Reading it from
--    the lines makes disagreement impossible.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW "invoice_provenance" WITH (security_invoker = true) AS
SELECT
  i.id AS invoice_id,
  i.company_id,
  CASE
    WHEN COUNT(DISTINCT l.fulfilment_source) = 0 THEN 'direct'
    WHEN COUNT(DISTINCT l.fulfilment_source) > 1 THEN 'mixed'
    ELSE MIN(l.fulfilment_source::text)
  END AS source_type,
  COUNT(*) FILTER (WHERE l.fulfilment_source = 'stock_request') AS stock_request_lines,
  COUNT(*) FILTER (WHERE l.fulfilment_source = 'checkout')      AS checkout_lines,
  COUNT(*) FILTER (WHERE l.fulfilment_source = 'weighbridge')   AS weighbridge_lines
FROM invoices i
LEFT JOIN invoice_lines l ON l.invoice_id = i.id
GROUP BY i.id, i.company_id;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Row-Level Security on every new tenant-scoped table.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products', 'stock_requests', 'item_checkouts', 'weighbridge_tickets',
    'invoices', 'invoice_lines', 'cogs_postings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;

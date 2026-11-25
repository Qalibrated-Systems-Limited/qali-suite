-- ============================================================================
-- INVENTORY RECORDS CARRY ATTACHED DOCUMENTS
--
-- One store of documents for the inventory module: a product's data sheet or
-- safety sheet, a receipt's delivery note and certificates, the photos and
-- reports behind an adjustment or write-off, signed count sheets, NCR
-- evidence and supplier correspondence, a requisition's quotations.
--
-- Files live in the upload store (Cloudinary); this table holds what they
-- are, what they belong to, and who attached them. `entity_id` is not a
-- foreign key because it names rows in six tables; the action checks the
-- record exists in the company before attaching.
--
-- SAFE TO APPLY because: a new, empty table.
-- ============================================================================

CREATE TABLE "inventory_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "category" text DEFAULT 'other' NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "public_id" text,
  "mime_type" text,
  "size_bytes" integer,
  "note" text DEFAULT '' NOT NULL,
  "uploaded_by_id" text,
  "uploaded_by_name" text DEFAULT 'System' NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_documents_entity_valid" CHECK ("entity_type" IN (
    'product', 'goods_receipt', 'stock_adjustment', 'stock_count', 'nonconformance', 'stock_request'
  )),
  CONSTRAINT "inventory_documents_name_not_blank" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "inventory_documents_url_https" CHECK ("url" LIKE 'https://%')
);--> statement-breakpoint
CREATE INDEX "inventory_documents_entity_idx" ON "inventory_documents" ("company_id", "entity_type", "entity_id", "uploaded_at");--> statement-breakpoint

ALTER TABLE "inventory_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "inventory_documents"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON "inventory_documents" TO app_user;

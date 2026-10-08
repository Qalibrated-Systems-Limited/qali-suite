-- 0126 — project documents.
--
-- The files a project carries (contract, BOQ, budget, drawings, certificates,
-- correspondence…), uploaded through the existing /api/upload → Cloudinary
-- path. Only metadata and the returned URL/publicId are stored here. One table,
-- tenant-scoped with the standard tenant_isolation policy.

CREATE TABLE "project_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "category" text DEFAULT 'other' NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "file_url" text NOT NULL,
  "file_name" text DEFAULT '' NOT NULL,
  "mime_type" text DEFAULT '' NOT NULL,
  "size_bytes" integer DEFAULT 0 NOT NULL,
  "public_id" text,
  "resource_type" text,
  "uploaded_by_id" text,
  "uploaded_by_name" text DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_documents_url_not_blank" CHECK (length(btrim("file_url")) > 0),
  CONSTRAINT "project_documents_category_valid" CHECK ("category" IN ('contract','boq','budget','drawing','certificate','variation','correspondence','permit','insurance','other'))
);
--> statement-breakpoint
ALTER TABLE "project_documents"
  ADD CONSTRAINT "project_documents_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_documents"
  ADD CONSTRAINT "project_documents_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_documents"
  ADD CONSTRAINT "project_documents_uploaded_by_id_users_id_fk"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_documents_company_project_idx"
  ON "project_documents" USING btree ("company_id", "project_id");
--> statement-breakpoint
CREATE INDEX "project_documents_company_category_idx"
  ON "project_documents" USING btree ("company_id", "category");
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_documents']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;

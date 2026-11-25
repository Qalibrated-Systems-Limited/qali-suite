-- ============================================================================
-- EACH MODULE KEEPS SAVED CUSTOM REPORTS
--
-- The report builder lets a person choose a module's activity dataset, the
-- columns, filters, date range, grouping and totals. A report they want again
-- is saved here: its definition only, never its rows — it is re-run against
-- live data each time, under the viewer's own access.
--
-- SAFE TO APPLY because: a new, empty table.
-- ============================================================================

CREATE TABLE "report_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "module" text NOT NULL,
  "name" text NOT NULL,
  "definition" jsonb NOT NULL,
  "shared" boolean DEFAULT true NOT NULL,
  "created_by_id" text,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "report_definitions_name_not_blank" CHECK (length(btrim("name")) > 0)
);--> statement-breakpoint
CREATE INDEX "report_definitions_company_module_idx" ON "report_definitions" ("company_id", "module", "name");--> statement-breakpoint

ALTER TABLE "report_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "report_definitions"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "report_definitions" TO app_user;

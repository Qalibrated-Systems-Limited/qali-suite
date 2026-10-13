-- ─────────────────────────────────────────────────────────────────────────────
-- 0118 — Cost codes from the BOQ.
--
-- A cost code is created against one BOQ item, or a group of items budgeted
-- together. This join records which items a code covers; a manual code has no
-- rows here. Company-scoped and RLS'd. Touches only this new table.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "project_cost_code_boq_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"boq_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "project_cost_code_boq_items" ADD CONSTRAINT "project_cost_code_boq_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_code_boq_items" ADD CONSTRAINT "project_cost_code_boq_items_cost_code_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."project_cost_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cost_code_boq_items" ADD CONSTRAINT "project_cost_code_boq_items_boq_item_id_fk" FOREIGN KEY ("boq_item_id") REFERENCES "public"."project_boq_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "project_cost_code_boq_items_uq" ON "project_cost_code_boq_items" USING btree ("cost_code_id","boq_item_id");--> statement-breakpoint
CREATE INDEX "project_cost_code_boq_items_item_idx" ON "project_cost_code_boq_items" USING btree ("company_id","boq_item_id");--> statement-breakpoint
CREATE INDEX "project_cost_code_boq_items_code_idx" ON "project_cost_code_boq_items" USING btree ("cost_code_id");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
ALTER TABLE "project_cost_code_boq_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_cost_code_boq_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "project_cost_code_boq_items"
	USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_cost_code_boq_items" TO app_user;

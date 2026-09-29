-- 0119 — a project's default expense account for budget lines.
--
-- Budgets are built from BOQ items and a cost code is created for each (0118);
-- every code needs an account. Most projects charge the same account for every
-- item, so this remembers it once per project and new BOQ budget lines
-- pre-select it. Nullable — a project without one simply asks per line, exactly
-- as before this column existed.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "default_cost_account_id" uuid;
--> statement-breakpoint

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_default_cost_account_id_accounts_id_fk"
  FOREIGN KEY ("default_cost_account_id")
  REFERENCES "public"."accounts"("id")
  ON DELETE set null ON UPDATE no action;

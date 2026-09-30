-- 0121 — assign individual permissions to roles, and deactivate roles.
--
-- 0120 made roles editable data (custom roles + a base). This adds the other
-- half the product asked for: a selectable list of permissions granted per role,
-- and an active flag so a role can be switched off without deleting it.
--
-- A role's effective permissions are: the explicit rows here if it has any,
-- otherwise the code defaults for its (base) role. So a role stays on its code
-- defaults until someone edits it, and editing MATERIALISES the full set — after
-- which the rows are the truth. can() reads this; the legacy in-code gates still
-- back-stop write actions by base role.

CREATE TABLE "role_permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "role_name" text NOT NULL,
  "permission_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "role_permissions_role_not_blank" CHECK (length(btrim("role_name")) > 0),
  CONSTRAINT "role_permissions_key_not_blank" CHECK (length(btrim("permission_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_uq"
  ON "role_permissions" USING btree ("company_id", lower("role_name"), "permission_key");
--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx"
  ON "role_permissions" USING btree ("company_id", lower("role_name"));
--> statement-breakpoint

-- A role can be switched off without deleting it.
ALTER TABLE "custom_roles"
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['role_permissions']
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

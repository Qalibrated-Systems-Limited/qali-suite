-- 0120 — custom roles: make roles editable data without loosening enforcement.
--
-- A custom role is a company-defined name with a canonical BASE role it is
-- authorised as. resolveRoleForCompany() maps a custom role to its base, so the
-- app's ~400 permission gates keep checking a canonical role and cannot be
-- tricked into granting more than a base role the code already trusts.
--
-- The two role names the QMS/SOP/Compliance gates referenced but no user could
-- hold ('Quality Manager', 'Technical Manager') are seeded here as system
-- custom roles based on 'Manager' — Manager already carried those gates, so the
-- names were removed from the arrays in the same change.

CREATE TABLE "custom_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "base_role" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "created_by_id" text,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "custom_roles_name_not_blank" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "custom_roles_base_valid" CHECK ("base_role" IN (
    'SuperAdmin', 'Admin', 'CFO', 'Finance Manager', 'Accountant',
    'Sales Manager', 'Procurement Officer', 'Manager', 'Store Manager',
    'Storekeeper', 'HR Manager', 'Employee', 'Viewer'
  ))
);
--> statement-breakpoint
ALTER TABLE "custom_roles"
  ADD CONSTRAINT "custom_roles_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_roles_company_name_uq"
  ON "custom_roles" USING btree ("company_id", lower("name"));
--> statement-breakpoint
CREATE INDEX "custom_roles_company_idx"
  ON "custom_roles" USING btree ("company_id");
--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['custom_roles']
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
--> statement-breakpoint

-- Relax the hard-coded role allow-lists so a custom role name can be assigned.
-- The canonical set is still enforced for the BASE of every custom role
-- (custom_roles_base_valid) and validated in the app; here we only require a
-- non-empty string, exactly as the name column does.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_valid";
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_role_not_blank" CHECK (length(btrim("role")) > 0);
--> statement-breakpoint
ALTER TABLE "user_company_access" DROP CONSTRAINT IF EXISTS "user_company_access_role_valid";
--> statement-breakpoint
ALTER TABLE "user_company_access"
  ADD CONSTRAINT "user_company_access_role_not_blank"
  CHECK ("role" IS NULL OR length(btrim("role")) > 0);
--> statement-breakpoint

-- Seed the two roles the gates named but nobody could hold, for every company,
-- as Manager-based system roles. Idempotent against the unique index.
INSERT INTO "custom_roles" (company_id, name, base_role, description, is_system, created_by_name)
SELECT c.id, v.name, 'Manager', v.descr, true, 'System'
  FROM companies c
  CROSS JOIN (VALUES
    ('Quality Manager', 'Quality function lead (ISO 9001 / 17025) — authorised as a Manager.'),
    ('Technical Manager', 'Technical department lead (calibration & inspection) — authorised as a Manager.')
  ) AS v(name, descr)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 0024 — The three tables RLS did not cover.
--
-- An audit of every table in `public` after 0023: 26 of 29 had RLS enabled and
-- forced. The three that did not are the three without a company_id column, and
-- each is a real gap rather than an exemption.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. companies — the tenant registry.
--
--    It has no company_id because its own id IS the tenant, which is why the
--    per-table loop skipped it. The effect was that any application connection
--    could `SELECT * FROM companies` and enumerate every tenant on the
--    platform: names, slugs, count. Not the books, but a customer list.
--
--    The policy is the same rule, keyed on id.
--
--    CREATING a company is deliberately NOT a tenant operation. A connection
--    scoped to tenant A has no business inserting tenant B, and no business
--    inserting A either — provisioning happens before any scope exists. So
--    there is no WITH CHECK that could sensibly pass, and tenant creation
--    belongs on the privileged connection, the same one that runs migrations.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON "companies";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "companies"
  USING (id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. _migration_id_map and _migration_rejects — backfill scaffolding.
--
--    _migration_rejects.detail is jsonb holding the payload of every row the
--    backfill could not convert (§6.2). During the §6.3 cutover that is real
--    business data — an invoice that failed to map is still an invoice — sitting
--    in a table with no company_id to scope by and, until now, readable by the
--    application role.
--
--    _migration_id_map is less sensitive but still lets anyone enumerate how
--    many records exist and correlate old Mongo ObjectIds to new UUIDs.
--
--    Neither has a tenant column to write a policy against, so the lever is the
--    grant rather than a policy: 0023's GRANT … ON ALL TABLES swept both up.
--
--    They are NOT treated the same, because the application uses one of them.
--
--    _migration_id_map is read on the request path — app/db/tenant.ts resolves
--    the Mongo company id a session still carries into the Postgres UUID
--    through it. Revoking it outright breaks every request, which is how this
--    was found. So it keeps SELECT and loses the rest: only the backfill writes
--    it. That leaves a residual disclosure — any tenant can read the whole map
--    — which is accepted for the duration of the transition, on the grounds
--    that it maps identifiers and holds no business data. It should be revoked
--    entirely once sessions carry UUIDs and §6.3 cutover is done.
--
--    _migration_rejects is read by nobody in the application, and its `detail`
--    column holds the payload of rows the backfill could not convert — real
--    business data. It loses everything.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON "_migration_id_map" FROM app_user;
--> statement-breakpoint
GRANT SELECT ON "_migration_id_map" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "_migration_rejects" FROM app_user;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A standing audit, so a table added later cannot quietly miss RLS.
--
--    Returns one row per table that carries tenant data and is not protected.
--    Empty is the passing state. Worth asserting in CI and before cutover —
--    every gap above existed because a table was added outside the loop that
--    enables the policies, and nothing was watching.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW "rls_coverage_gaps" AS
SELECT c.relname AS table_name,
       c.relrowsecurity     AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) AS has_policy
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   -- Tables that carry tenant data: a company_id column, or companies itself.
   AND (c.relname = 'companies'
        OR EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid
                      AND a.attname = 'company_id'
                      AND NOT a.attisdropped))
   AND NOT (c.relrowsecurity
            AND c.relforcerowsecurity
            AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid));
--> statement-breakpoint

GRANT SELECT ON "rls_coverage_gaps" TO app_user;

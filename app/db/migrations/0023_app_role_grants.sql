-- ============================================================================
-- 0023 — The application role, and why it must not be the owner.
--
-- Row-level security is only as good as the role the application connects as.
-- FORCE ROW LEVEL SECURITY binds the table OWNER, but nothing binds a role with
-- BYPASSRLS, and superusers always have it. Measured on this schema, same query,
-- one invoice present, no app.company_id set:
--
--   postgres (superuser)                -> 1 row    RLS bypassed entirely
--   non-superuser with full grants      -> 0 rows   fails closed, as designed
--
-- So a DATABASE_URL pointing at the superuser makes every policy written in
-- 0001, 0006, 0008, 0012, 0014, 0016, 0019 and 0022 silently inert. The tenant
-- isolation this migration exists to provide would be back to depending on the
-- application remembering a WHERE clause — which is §2.2, the thing the whole
-- port is meant to remove.
--
-- app_user already existed on this database (rolsuper=f, rolbypassrls=f) but
-- had no grants, so nothing could actually connect as it. This gives it exactly
-- the DML it needs and nothing more.
--
-- The migration connection stays privileged, deliberately: it runs DDL, and
-- 0017's reconciliation scans across companies unscoped. See app/db/migrate.mjs.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    -- NOLOGIN: the password is set out of band, per environment. A role with
    -- no password cannot be used to connect, so this is safe to create here.
    CREATE ROLE app_user NOLOGIN;
    RAISE NOTICE 'created role app_user — set a password and LOGIN before use';
  END IF;
END $$;
--> statement-breakpoint

-- Belt and braces. A future ALTER that granted BYPASSRLS would quietly disable
-- every policy in the schema, so state the requirement explicitly.
ALTER ROLE app_user NOBYPASSRLS NOSUPERUSER;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint

-- DML only. No DDL, no TRUNCATE: the application never reshapes the schema, and
-- TRUNCATE ignores RLS policies entirely, which would be a cross-tenant delete.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
--> statement-breakpoint

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
--> statement-breakpoint

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;
--> statement-breakpoint

-- Tables added by later migrations inherit these, so a new table is not
-- silently unreadable by the application until someone notices.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_user;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A standing check, so the requirement is verifiable rather than remembered.
--
-- Call it from a health check or a deploy step:  SELECT assert_rls_effective();
-- It raises if the CURRENT connection would bypass RLS, which is the one
-- condition under which the tenant boundary is not actually enforced.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assert_rls_effective() RETURNS void AS $$
DECLARE
  v_super  boolean;
  v_bypass boolean;
BEGIN
  SELECT rolsuper, rolbypassrls INTO v_super, v_bypass
    FROM pg_roles WHERE rolname = current_user;

  IF v_super OR v_bypass THEN
    RAISE EXCEPTION
      'Connected as %, which bypasses row-level security. Tenant isolation is NOT enforced on this connection. The application must connect as a role with NOSUPERUSER and NOBYPASSRLS (app_user).',
      current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$ LANGUAGE plpgsql;

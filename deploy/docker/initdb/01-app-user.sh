#!/bin/bash
# ============================================================================
# Creates the role the APPLICATION connects as.
#
# Runs once, on first start, only while the data directory is empty — that is
# how /docker-entrypoint-initdb.d works. Re-running it later does nothing; see
# DEPLOYMENT.md for how to apply the same SQL to an existing volume.
#
# WHY THIS IS A SCRIPT AND NOT A LINE IN THE README.
#
# Tenant isolation in this application IS row-level security. Every tenant
# table is FORCE ROW LEVEL SECURITY with a policy comparing company_id against
# current_setting('app.company_id').
#
# A SUPERUSER BYPASSES ALL OF IT. If the app connects as `postgres`, every
# policy is skipped and any tenant reads every other tenant's ledger — with no
# error, and nothing in the logs. The container's default user is a superuser,
# so "it works" is exactly what a misconfigured deployment looks like.
#
# Doing it here means the correct role exists before anyone can point the app
# at the wrong one.
# ============================================================================
set -euo pipefail

: "${APP_DB_USER:?APP_DB_USER must be set}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" <<-EOSQL
	-- LOGIN and nothing else. No SUPERUSER, no BYPASSRLS, no CREATEDB.
	CREATE ROLE "${APP_DB_USER}" LOGIN PASSWORD '${APP_DB_PASSWORD}';

	GRANT USAGE ON SCHEMA public TO "${APP_DB_USER}";
	GRANT ALL ON ALL TABLES    IN SCHEMA public TO "${APP_DB_USER}";
	GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${APP_DB_USER}";

	-- The important half. Migrations run LATER, as \`postgres\`, and create
	-- ~139 tables. Without a default-privilege grant the app has permission to
	-- none of them, and the first request fails with "permission denied for
	-- table companies" long after this script looked like it succeeded.
	--
	-- Scoped to objects created BY postgres, which is who the migrator connects
	-- as (DIRECT_DATABASE_URL).
	ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public
	  GRANT ALL ON TABLES    TO "${APP_DB_USER}";
	ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public
	  GRANT ALL ON SEQUENCES TO "${APP_DB_USER}";
EOSQL

# Prove it rather than assume it. A superuser or BYPASSRLS role here means the
# deployment is not tenant-safe, and it is far cheaper to fail now than to
# discover it from a customer.
IS_UNSAFE=$(psql -tAX -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = '${APP_DB_USER}';")

if [ "$IS_UNSAFE" != "f" ]; then
  echo "FATAL: ${APP_DB_USER} can bypass row-level security. Refusing to continue." >&2
  exit 1
fi

echo "[initdb] ${APP_DB_USER} created — not a superuser, cannot bypass RLS."

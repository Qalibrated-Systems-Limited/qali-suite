/**
 * Global test setup — runs ONCE per Vitest worker, before any test file.
 *
 * Provisions the restricted Postgres role the integration suites connect on.
 *
 * IT USED TO BOOT A MONGODB REPLICA SET TOO — 0102. Every run downloaded and
 * started an in-memory MongoDB 7.0.14 single-node replica set, because the
 * money paths were Mongo multi-document transactions and those need a replica
 * set. Nothing in the repository connects to Mongo any more, so the whole
 * fixture went with the models: a mongod process per worker, started before
 * the first test and stopped after the last, serving nobody.
 *
 * Returns a teardown function — Vitest calls it after the last test.
 */

/**
 * Postgres integration tests need a NON-SUPERUSER role: a superuser bypasses
 * RLS even under FORCE ROW LEVEL SECURITY, so isolation tests would pass
 * vacuously.
 *
 * Created ONCE here rather than per test file. Six files each running
 * CREATE ROLE / DROP OWNED BY / DROP ROLE against the same database produced
 * intermittent cross-file failures — the churn, not the tests.
 */
const PG_TEST_ROLE = "app_test_role";
const PG_TEST_PASSWORD = "app_test_pw";

/**
 * The privileged connection. CREATE ROLE, GRANT and TRUNCATE all need
 * privileges the application's own role does not have — DATABASE_URL connects
 * as app_user, which migration 0023 deliberately denies TRUNCATE because it
 * ignores RLS policies and would be a cross-tenant delete.
 *
 * Falls back to DATABASE_URL for a single-role local setup.
 */
function adminUrl() {
  return process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
}

/** Same database, restricted role. Integration tests connect on this. */
export function pgTestUrl() {
  const base = adminUrl();
  if (!base) return null;
  const url = new URL(base);
  url.username = PG_TEST_ROLE;
  url.password = PG_TEST_PASSWORD;
  return url.toString();
}

/**
 * REFUSES TO RUN AGAINST A DATABASE THAT IS NOT A TEST DATABASE.
 *
 * Every Postgres suite begins `TRUNCATE companies CASCADE`, which removes every
 * tenant and everything that cascades from one. vitest.config.mjs loads `.env`
 * so the suites find a URL — and on a developer machine that URL is usually
 * the database the dev server is running against. Running the tests then wipes
 * the company you were working in, and the first symptom is an unrelated error
 * on a dashboard page.
 *
 * That happened. This is the guard.
 *
 * A database counts as a test database if its name contains "test", or if
 * PGTEST_ALLOW_DESTRUCTIVE=1 says the caller means it. The second exists
 * because CI and throwaway containers are legitimately named anything.
 */
function assertDestructiveDatabaseIsSafe() {
  const url = adminUrl();
  if (!url) return;
  if (process.env.PGTEST_ALLOW_DESTRUCTIVE === "1") return;

  const name = new URL(url).pathname.replace(/^\//, "");
  if (/test/i.test(name)) return;

  throw new Error(
    `Refusing to run the Postgres suites against "${name}".\n\n` +
      "They TRUNCATE every tenant table, so pointing them at a working " +
      "database destroys its data.\n\n" +
      "Either:\n" +
      `  • create a test database and put its URL in .env.local, or\n` +
      "  • set PGTEST_ALLOW_DESTRUCTIVE=1 if this database really is disposable.",
  );
}

async function setupPostgresRole() {
  if (!adminUrl()) return;
  assertDestructiveDatabaseIsSafe();
  const { default: postgres } = await import("postgres");
  const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
  try {
    /**
     * ALL OF IT IN ONE TRANSACTION, UNDER A TRANSACTION-SCOPED LOCK.
     *
     * This runs once per WORKER, not once per run, and role DDL plus
     * `GRANT ALL ON ALL TABLES` take exclusive locks on shared catalogue rows.
     * Several workers doing that against one database deadlock on pg_class or
     * lose a tuple update — and the failure surfaces as an error against a
     * GRANT, inside whichever test file happened to lose, whose own queries
     * are all sequential and entirely innocent.
     *
     * A session-level pg_advisory_lock did NOT fix it: postgres.js runs
     * `sql.unsafe()` on its own connection, so the lock was taken on one
     * connection and the DDL executed on another. pg_advisory_xact_lock inside
     * a single transaction cannot come apart that way, and it releases on
     * commit with no unlock to forget.
     *
     * Idempotent as well as serialised: the role is a fixture with a constant
     * password, so one left over from a previous run is the same role. Adopt
     * it rather than dropping and rebuilding it every time.
     */
    await admin.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('erp_test_role_setup'))`;

      // A ROLE IS CLUSTER-WIDE; ITS GRANTS ARE PER-DATABASE. Skipping the
      // grants because the role already exists worked until the suites were
      // pointed at a second database, where the role was present and had
      // permission to nothing — "permission denied for table companies".
      // Creating the role is the only part that must not repeat.
      const [existing] = await tx`
        SELECT 1 AS present FROM pg_roles WHERE rolname = ${PG_TEST_ROLE}
      `;
      if (!existing) {
        await tx.unsafe(
          `CREATE ROLE ${PG_TEST_ROLE} LOGIN PASSWORD '${PG_TEST_PASSWORD}'`,
        );
      }

      // Idempotent, and cheap enough to repeat now that the lock above stops
      // several workers doing it at once.
      await tx.unsafe(`GRANT USAGE ON SCHEMA public TO ${PG_TEST_ROLE}`);
      await tx.unsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${PG_TEST_ROLE}`);
      await tx.unsafe(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${PG_TEST_ROLE}`);
    });

    /**
     * THE SUITE IS BOUND BY TRUNCATE, AND TRUNCATE IS BOUND BY fsync.
     *
     * Every Postgres suite clears the tenant tables before each test, and a
     * cascade from `companies` reaches all 82 of them at roughly 30ms each.
     * Measured on this schema: 4.6s per test across the three statements the
     * suites issue, which is the bulk of a half-hour run — the tests
     * themselves are milliseconds.
     *
     * `synchronous_commit = off` takes that to ~2.3s by not waiting for WAL
     * flush on each commit. The trade is that a server crash can lose the last
     * few transactions, which for a database whose every test begins by
     * deleting all of its contents is not a trade at all.
     *
     * Set on the DATABASE so every connection inherits it — the suites open
     * their own clients, and a per-session SET would have to be repeated in
     * each of the 66 files and forgotten in the 67th. The name guard above has
     * already established this is a test database.
     */
    const dbName = new URL(adminUrl()).pathname.replace(/^\//, "");
    await admin.unsafe(
      `ALTER DATABASE "${dbName}" SET synchronous_commit = off`,
    );

    process.env.PG_TEST_URL = pgTestUrl();
  } finally {
    await admin.end();
  }
}

/**
 * Deliberately does NOT drop the test role.
 *
 * Teardown runs per WORKER, so dropping it here pulls the role out from under
 * a worker that is still running — the same catalogue churn the setup side
 * stopped doing. It is a fixture with a constant password, owns nothing, and
 * the next run adopts it.
 */
async function teardownPostgresRole() {
  return;
}

export async function setup() {
  // Say so, loudly. The Postgres suites are `DATABASE_URL ? describe :
  // describe.skip`, so with no URL they skip and the run still reports
  // "passed" — 130 integration tests excluded, and nothing in the summary
  // that reads as a problem.
  if (!process.env.DATABASE_URL) {
    console.warn(
      "\n⚠  DATABASE_URL is not set — every Postgres integration suite will SKIP.\n" +
        "   Set it in .env (vitest.config.mjs loads it from there).\n" +
        "   Local: postgresql://postgres:postgres@localhost:5433/stockvault\n",
    );
  }

  await setupPostgresRole();
}

export async function teardown() {
  await teardownPostgresRole();
}

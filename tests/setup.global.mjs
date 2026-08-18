/**
 * Global test setup — runs ONCE per Vitest worker, before any test file.
 *
 * Spawns an in-memory MongoDB REPLICA SET (single node) and exposes its
 * URI via `process.env.MONGODB_URI` so the existing
 * `app/config/dbConnect.js` picks it up unchanged.
 *
 * Why a replica set and not a standalone server: the money paths use
 * multi-document transactions (invoice.complete, payment.confirm,
 * adjustment.approve, lead conversion…), and Mongo only allows
 * transactions on replica sets / mongos — exactly what prod (Atlas) is.
 * A standalone memory server made every transactional test fail with
 * "Transaction numbers are only allowed on a replica set member".
 *
 * Returns a teardown function — Vitest calls it after the last test.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";

let replSet;

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

  replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1, // single node is enough for transaction support
      // MongoDB gives a transaction only 5ms by default to acquire each lock
      // (maxTransactionLockRequestTimeoutMillis). That is fine on an idle
      // server, but this suite truncates every collection between tests, so a
      // transaction opening right behind a truncation could miss the window
      // and fail with:
      //
      //   Unable to acquire IX lock on '...bankfeedlines' within 5ms
      //
      // which surfaced as an intermittent failure in
      // tests/bank-feed-tenant-scope.test.mjs at roughly a 1-in-4 rate.
      //
      // This raises the window for the TEST server only. It does not change
      // application behaviour, and deliberately does NOT paper over a real
      // deadlock: 500ms is still far below any timeout a genuine lock cycle
      // would blow through.
      args: ["--setParameter", "maxTransactionLockRequestTimeoutMillis=500"],
    },
    binary: {
      // Match a recent prod-style version. Atlas defaults to 7.x; pinning
      // here keeps test behavior deterministic across dev machines.
      // NOTE: the CI cache key in .github/workflows/test.yml embeds this
      // version — bump both together.
      version: "7.0.14",
    },
  });
  process.env.MONGODB_URI = replSet.getUri();
  // Disable the runtime warning some Mongoose plugins emit when no
  // explicit "global cluster" feature is in use.
  process.env.MONGOMS_DISABLE_POSTINSTALL = "1";

  await setupPostgresRole();
}

export async function teardown() {
  await teardownPostgresRole();
  if (replSet) {
    await replSet.stop();
    replSet = undefined;
  }
}

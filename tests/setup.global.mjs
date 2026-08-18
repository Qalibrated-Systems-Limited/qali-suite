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

async function setupPostgresRole() {
  if (!adminUrl()) return;
  const { default: postgres } = await import("postgres");
  const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP OWNED BY ${PG_TEST_ROLE}`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS ${PG_TEST_ROLE}`).catch(() => {});
    await admin.unsafe(`CREATE ROLE ${PG_TEST_ROLE} LOGIN PASSWORD '${PG_TEST_PASSWORD}'`);
    await admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${PG_TEST_ROLE}`);
    await admin.unsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${PG_TEST_ROLE}`);
    await admin.unsafe(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${PG_TEST_ROLE}`);
    process.env.PG_TEST_URL = pgTestUrl();
  } finally {
    await admin.end();
  }
}

async function teardownPostgresRole() {
  if (!adminUrl()) return;
  const { default: postgres } = await import("postgres");
  const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP OWNED BY ${PG_TEST_ROLE}`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS ${PG_TEST_ROLE}`).catch(() => {});
  } finally {
    await admin.end();
  }
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

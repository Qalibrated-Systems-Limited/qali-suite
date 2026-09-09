import { defineConfig } from "vitest/config";
// loadEnv is not re-exported by vitest/config in this version.
import { loadEnv } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load .env for the test run.
 *
 * Vitest does not read .env on its own, and `npm test` is plain `vitest run`
 * with no --env-file. So DATABASE_URL reached the tests only if the shell
 * happened to export it — and the Postgres suites are
 * `DATABASE_URL ? describe : describe.skip`, so without it they SKIP. A green
 * "270 passed" that quietly excluded 130 integration tests is worse than a red
 * one.
 *
 * The empty prefix loads every variable, not just VITE_-prefixed ones. A real
 * shell variable still wins, so `DATABASE_URL=... npx vitest` keeps working.
 */
const fileEnv = loadEnv("test", __dirname, "");
const DATABASE_URL = process.env.DATABASE_URL || fileEnv.DATABASE_URL || "";
// The privileged connection, used by globalSetup to provision app_test_role
// and by the suites to TRUNCATE. DATABASE_URL connects as app_user, which
// has neither privilege by design (migration 0023).
const DIRECT_DATABASE_URL =
  process.env.DIRECT_DATABASE_URL || fileEnv.DIRECT_DATABASE_URL || "";

/**
 * Set it on the MAIN process too, not just the workers.
 *
 * `test.env` reaches worker processes only, and globalSetup runs in this one.
 * setup.global.mjs provisions app_test_role there and exports PG_TEST_URL for
 * the workers to connect on — a non-superuser, because a superuser bypasses
 * RLS and makes every isolation test pass vacuously.
 *
 * With the URL in the workers alone, that provisioning silently no-ops, the
 * workers fall back to connecting as the superuser, and the tenant-isolation
 * tests go green while enforcing nothing. That is exactly the failure mode
 * §9A describes, and it showed up here first.
 */
if (DATABASE_URL) process.env.DATABASE_URL = DATABASE_URL;
if (DIRECT_DATABASE_URL) process.env.DIRECT_DATABASE_URL = DIRECT_DATABASE_URL;

export default defineConfig({
  resolve: {
    // Mirror tsconfig.json paths so test files can use `@/...` imports.
    alias: {
      "@": __dirname,
      // Next supplies this at build time; see tests/helpers/server-only-stub.mjs.
      "server-only": path.resolve(__dirname, "tests/helpers/server-only-stub.mjs"),
    },
  },
  test: {
    environment: "node",
    env: { DATABASE_URL, DIRECT_DATABASE_URL },
    // Boot mongodb-memory-server + connect Mongoose ONCE per worker, then
    // truncate collections between tests. Setup lives in tests/setup.mjs.
    globalSetup: ["./tests/setup.global.mjs"],
    // No setupFiles: tests/setup.mjs connected Mongoose to the in-memory
    // cluster and truncated its collections between tests. Both the cluster
    // and the models are gone (0102); each Postgres suite manages its own
    // truncation, which it always did.
    // Sequential by default — Mongoose connection state is process-wide
    // and parallel Mongo writes against the same in-memory cluster create
    // false-positive uniqueness conflicts.
    fileParallelism: false,
    testTimeout: 30_000, // memory-server cold start can take ~5s on first run
    /**
     * 120s, not 60s. Every Postgres suite opens with `TRUNCATE companies
     * CASCADE`, which takes an ACCESS EXCLUSIVE lock and cascades across the
     * 29 tables that reference `companies`. On a loaded machine that hook
     * genuinely exceeded 60s, and the symptom is not a clear timeout — the
     * NEXT test's fixture insert collides on a unique index, because the
     * truncate that should have cleared the previous tenant never finished.
     * Measured here on a two-core CI-shaped load; the failing test moved
     * between runs, which is what told us it was the clock and not the schema.
     *
     * A hook that is actually hung still fails, just later.
     */
    hookTimeout: 120_000,
    include: ["tests/**/*.test.{js,mjs,ts}"],
    exclude: ["node_modules", ".next"],
    coverage: {
      provider: "v8",
      include: [
        // app/models/** and app/mongodb/** are gone with 0102. Coverage is
        // measured over app/db/**, which is where the logic lives now.
        "app/db/actions/**",
        "app/db/repositories/**",
        "lib/business-rules.js",
        "lib/permissions.js",
        "lib/utils/tenant-utils.js",
      ],
      exclude: ["**/*.test.*", "tests/**"],
    },
  },
});

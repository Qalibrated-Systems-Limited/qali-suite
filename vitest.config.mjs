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
    },
  },
  test: {
    environment: "node",
    env: { DATABASE_URL, DIRECT_DATABASE_URL },
    // Boot mongodb-memory-server + connect Mongoose ONCE per worker, then
    // truncate collections between tests. Setup lives in tests/setup.mjs.
    globalSetup: ["./tests/setup.global.mjs"],
    setupFiles: ["./tests/setup.mjs"],
    // Sequential by default — Mongoose connection state is process-wide
    // and parallel Mongo writes against the same in-memory cluster create
    // false-positive uniqueness conflicts.
    fileParallelism: false,
    testTimeout: 30_000, // memory-server cold start can take ~5s on first run
    hookTimeout: 60_000, // covers binary download on a brand-new dev machine
    include: ["tests/**/*.test.{js,mjs,ts}"],
    exclude: ["node_modules", ".next"],
    coverage: {
      provider: "v8",
      include: [
        "app/models/**",
        "app/mongodb/actions/**",
        "app/mongodb/queries/**",
        "lib/business-rules.js",
        "lib/permissions.js",
        "lib/utils/tenant-utils.js",
      ],
      exclude: ["**/*.test.*", "tests/**"],
    },
  },
});

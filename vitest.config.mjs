import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    // Mirror tsconfig.json paths so test files can use `@/...` imports.
    alias: {
      "@": __dirname,
    },
  },
  test: {
    environment: "node",
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

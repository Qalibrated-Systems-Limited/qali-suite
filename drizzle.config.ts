import { defineConfig } from "drizzle-kit";

/**
 * Vertical slice 1 — accounting core only. See docs/POSTGRES-MIGRATION-PLAN.md.
 *
 * `0000_*.sql` is generated from app/db/schema by `npm run db:generate`.
 * `0001_*.sql` onwards are hand-written (RLS policies, constraint triggers,
 * views) — drizzle-kit does not model those, so never regenerate over them.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./app/db/schema/index.ts",
  out: "./app/db/migrations",
  dbCredentials: {
    // Direct endpoint, not the pooled one: drizzle-kit introspects and runs
    // DDL, which does not survive transaction-mode pooling. Falls back to
    // DATABASE_URL so a single-database local setup needs only one value.
    // See the note in app/db/migrate.mjs.
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
  // The Mongo collections live in the same project during the slice; keep
  // drizzle-kit from ever touching anything it did not create.
  strict: true,
  verbose: true,
});

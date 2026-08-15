import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — see .env.example");
}

/**
 * `prepare: false` is required when running behind PgBouncer in transaction
 * pooling mode (and Neon's pooled endpoint). Named prepared statements do not
 * survive a connection being handed to another client between statements.
 */
const client = postgres(process.env.DATABASE_URL, {
  max: Number(process.env.PGPOOL_MAX ?? 10),
  prepare: false,
});

export const db = drizzle(client, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` with Postgres row-level security scoped to one tenant.
 *
 * Every repository function that touches tenant data MUST go through this.
 * Two things make it safe:
 *
 *   1. `set_config(..., true)` sets the value **transaction-local**. That is
 *      what makes this correct under connection pooling — the setting is
 *      discarded at COMMIT/ROLLBACK, so a pooled connection handed to the next
 *      request cannot inherit the previous tenant's scope. A session-level
 *      `SET` here would be a cross-tenant data leak under load.
 *
 *   2. The RLS policies compare against `current_setting('app.company_id',
 *      true)`. The `true` means "return NULL if unset" rather than raising, and
 *      `company_id = NULL` is NULL — so an unscoped query returns **zero rows**
 *      rather than every tenant's rows. It fails closed.
 *
 * This replaces the 3,479 hand-written `companyId` filters in the Mongo layer,
 * where forgetting one leaked another tenant's books instead of returning
 * nothing.
 */
export async function withTenant<T>(
  companyId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!companyId) {
    throw new Error("withTenant called without a companyId");
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.company_id', ${companyId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Escape hatch for genuinely cross-tenant work: migrations, backfill
 * reconciliation, platform admin. Runs as a role that bypasses RLS, so it is
 * deliberately noisy to call and must never be used from a request path.
 */
export async function withoutTenantScope<T>(
  reason: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_UNSCOPED_DB) {
    throw new Error(
      `withoutTenantScope("${reason}") blocked in production. ` +
        "Set ALLOW_UNSCOPED_DB=1 only for maintenance scripts.",
    );
  }
  return db.transaction(async (tx) => fn(tx));
}

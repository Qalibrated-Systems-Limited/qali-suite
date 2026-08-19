import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Lazily initialised.
 *
 * An earlier version threw at module scope when DATABASE_URL was unset. That
 * broke `next build`: collecting page data imports every route's module graph,
 * so any page importing a Postgres action failed the build on a machine or CI
 * runner that has no database — which is every machine, during a migration
 * where Postgres is not yet the primary store.
 *
 * Connecting on first query instead means importing this module is free, and
 * the missing-configuration error surfaces at the point of use, where it can
 * be caught and reported per request.
 */
let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

function connect() {
  if (_db) return _db;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — see .env.example");
  }

  // `prepare: false` is required when running behind PgBouncer in transaction
  // pooling mode (and Neon's pooled endpoint). Named prepared statements do not
  // survive a connection being handed to another client between statements.
  _client = postgres(process.env.DATABASE_URL, {
    max: Number(process.env.PGPOOL_MAX ?? 10),
    prepare: false,
  });
  _db = drizzle(_client, { schema });
  return _db;
}

/** True when a Postgres connection can be made. Lets callers fall back. */
export function isPostgresConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Proxied so `db.select(...)` connects on first use rather than at import.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const real = connect() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

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
  /**
   * Who is making the request. Set alongside the tenant so a policy can key on
   * the USER where that is the natural boundary — user_company_access does,
   * because "which companies may I enter" is asked before one is chosen (0033).
   */
  userId?: string | null,
): Promise<T> {
  if (!companyId) {
    throw new Error("withTenant called without a companyId");
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.company_id', ${companyId}, true)`,
    );
    if (userId) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    }
    return fn(tx);
  });
}

/**
 * Runs `fn` scoped to a USER but no company.
 *
 * For the one question that precedes choosing a tenant: which companies may
 * this person operate in. Only user_company_access has a policy that answers
 * under this scope; every company-keyed table returns zero rows, which is the
 * correct answer to asking them without a tenant.
 */
export async function withUserScope<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!userId) throw new Error("withUserScope called without a userId");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
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

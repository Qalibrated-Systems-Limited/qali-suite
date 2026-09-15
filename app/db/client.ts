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

/**
 * Runs `fn` scoped to a single API KEY, identified by the hash of its
 * plaintext, with no company scope.
 *
 * For the question that precedes choosing a tenant on a machine request: which
 * company does this bearer token belong to. `withUserScope` is the same idea
 * for a person; this is its counterpart for a connector, and exists because a
 * machine caller presents a secret INSTEAD of naming a tenant.
 *
 * Only `integration_keys` has a policy that answers under this scope, and it
 * answers with at most one row — the key whose plaintext the caller already
 * holds. Every other table returns nothing, which is the correct answer to
 * asking them before a tenant exists. The scope is transaction-local like the
 * others, so it cannot survive onto a pooled connection.
 *
 * The lookup is ALL this is for. Once the key resolves, apiTenant.ts reopens
 * under `withTenant` and the request runs under the ordinary company scope, so
 * an endpoint is not a second, weaker way into the same rows.
 */
export async function withApiKeyScope<T>(
  keyHash: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!keyHash) throw new Error("withApiKeyScope called without a keyHash");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.api_key_hash', ${keyHash}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Runs `fn` as the webhook retry worker: across every tenant, but only over
 * outbound deliveries that are awaiting or mid-attempt.
 *
 * The worker genuinely is cross-tenant — it runs on a cron with no session and
 * no company — and `withoutTenantScope` is the wrong tool for it twice over: it
 * is blocked in production, and it would hand a request path a connection that
 * can read every tenant's books to redeliver a webhook.
 *
 * So `sync_logs` carries a second policy under `app.worker` instead, scoped to
 * OUTBOUND deliveries — not inbound logs, and nothing of any tenant's books.
 *
 * The status narrowing ('retrying' and due) is in `claimDueRetries`, NOT in
 * the policy, and 0102 explains at length why moving it into the policy breaks
 * the worker rather than tightening it: Postgres applies SELECT policies to
 * the row an UPDATE leaves behind, so a policy that only admits in-flight
 * statuses forbids the worker from ever marking a delivery processed.
 */
export async function withRetryWorkerScope<T>(
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.worker', 'webhook-retry', true)`,
    );
    return fn(tx);
  });
}

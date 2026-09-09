import { NextResponse } from "next/server";
import { apiKeyAuth } from "@/lib/integrations/middleware/apiKeyAuth";
import { errorResponse } from "@/lib/integrations/utils/envelope";
import { withTenant, type Tx } from "./client";

/**
 * The door into Postgres for a request that carries an API key instead of a
 * session (0033–0036).
 *
 * `withAuthorizedTenant` is the session equivalent and cannot serve here: it
 * reads NextAuth, and a machine-to-machine caller has no session to read. The
 * two differ ONLY in how the tenant and the actor are established; everything
 * downstream — the transaction, `app.company_id`, `app.user_id`, every policy —
 * is identical, deliberately. An endpoint must not be a second, weaker way into
 * the same rows.
 *
 * WHY THIS EXISTS AT ALL, rather than each route wiring it up: a route that
 * calls a repository with a Tx it opened itself has to remember to resolve the
 * Mongo company id, to set the tenant, and to set the actor. Forgetting the
 * first two is caught by RLS returning nothing; forgetting the third is not
 * caught by anything, and writes rows nobody can be held to.
 *
 * WHAT IT DOES NOT DO: reach the server actions in app/db/actions. Those are
 * `"use server"` functions taking (prevState, FormData) and calling
 * withAuthorizedTenant internally — a session path by construction. Endpoints
 * call REPOSITORIES, which are plain `(tx, input)` functions and are where the
 * invariants already live.
 */

export interface ApiTenantContext {
  /** The tenant's Postgres uuid — already resolved, ready for a repository. */
  companyId: string;
  /**
   * Who to record as the actor.
   *
   * The user who CREATED the key, not the key itself. The 47 actor columns are
   * `text` today only because there was no users table when 0031 landed; 0036
   * says the foreign keys land once the backfill has run. An id like
   * "apikey:<id>" would read fine now and fail that migration later, so a key
   * acts on behalf of a person, which is also the honest answer to "who did
   * this". Null for keys issued before `createdBy` was recorded — the columns
   * are nullable, and a missing actor is better than an invented one.
   */
  actorId: string | null;
  actorName: string | null;
  keyId: string;
  keyName: string;
  scopes: string[];
  connectorType: string;
  environment: string;
}

/**
 * Authenticates the key, resolves its tenant, and runs `fn` inside a
 * transaction scoped to it.
 *
 * Returns whatever `fn` returns — a NextResponse in practice. Auth failures
 * short-circuit with the middleware's own response, so the caller sees the
 * same envelope every other /api/v1 route produces.
 */
export async function withApiKeyTenant(
  request: Request,
  opts: { requireScope?: string },
  fn: (tx: Tx, ctx: ApiTenantContext) => Promise<Response>,
): Promise<Response> {
  const auth = await apiKeyAuth(request, opts);
  if (!auth.ok) return auth.response;

  /**
   * NO ID RESOLUTION STEP ANY MORE.
   *
   * Until 0102 the key lived in Mongo and carried a Mongo company id, so this
   * put it through `resolveCompanyUuid` — a lookup in _migration_id_map that
   * could also PROVISION an empty tenant, on the request path, for a company
   * an API key claimed to belong to. `integration_keys.company_id` is a real
   * foreign key to `companies` now, so the tenant is resolved by the same
   * query that authenticated the key, and a key for a company that does not
   * exist cannot be written in the first place.
   */
  const companyId = auth.companyId;

  /**
   * The guard survives the removal of the lookup.
   *
   * There is no id map to miss any more, but "the key named no company" is
   * still reachable — a key row read before its company was set, or a caller
   * mocking the middleware — and it must stay a 409 that names the problem.
   * Without this it reaches `withTenant`, which throws a generic error that
   * the catch below reports as an INTERNAL_ERROR 500: our fault, for the
   * caller's bad key.
   */
  if (!companyId) {
    return errorResponse(
      "TENANT_UNAVAILABLE",
      "The key is not bound to a company",
      409,
    );
  }

  const createdBy = auth.createdBy as { id: string; name: string | null } | null;

  const ctx: ApiTenantContext = {
    companyId,
    actorId: createdBy?.id ?? null,
    actorName: createdBy?.name ?? null,
    keyId: auth.keyId,
    keyName: auth.keyName,
    scopes: auth.scopes ?? [],
    connectorType: auth.connectorType,
    environment: auth.environment,
  };

  try {
    return await withTenant(companyId, (tx) => fn(tx, ctx), ctx.actorId);
  } catch (err) {
    // A repository throws for a broken invariant — an oversell, an unbalanced
    // entry, a line that does not resolve. Those are the caller's fault and
    // must say so; anything else is ours and must not leak its internals.
    // ON `cause`, NOT ON THE ERROR. Drizzle wraps a driver failure in its own
    // DrizzleQueryError and puts the PostgresError underneath, so reading
    // err.code finds nothing and every constraint violation would have been
    // reported as a 500 — the caller's own malformed request blamed on us.
    // The suites already knew this shape (pg-provisioning reads
    // err.cause.constraint_name); a test written against it caught this.
    const driver = (err as { cause?: { code?: string } })?.cause ?? err;
    const code = (driver as { code?: string })?.code;
    const isConstraint = typeof code === "string" && code.startsWith("23");
    if (isConstraint) {
      // The driver's message names the constraint; the wrapper's names the
      // whole failed query, which is not something to hand back over HTTP.
      const detail =
        (driver as { message?: string })?.message ??
        (err instanceof Error ? err.message : "Request failed");
      return errorResponse("CONSTRAINT_VIOLATION", detail, 409);
    }
    console.error(`[api] ${ctx.keyName} (${ctx.keyId}):`, err);
    return errorResponse("INTERNAL_ERROR", "Request failed", 500);
  }
}

/** Narrow helper for routes that only read. Same scoping, clearer intent. */
export async function readWithApiKeyTenant(
  request: Request,
  opts: { requireScope?: string },
  fn: (tx: Tx, ctx: ApiTenantContext) => Promise<unknown>,
): Promise<Response> {
  return withApiKeyTenant(request, opts, async (tx, ctx) => {
    const data = await fn(tx, ctx);
    return NextResponse.json({ success: true, data });
  });
}

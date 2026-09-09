import { sql } from "drizzle-orm";
import { arrayOf } from "./sqlHelpers";
import type { Tx } from "../client";

/**
 * The integration control plane — 0102.
 *
 * Contract with the layer above, same as every repository here: each function
 * takes a `tx` whose scope has already been set, so RLS is what confines the
 * rows and nothing below reads a session.
 *
 * The unusual part is that there are THREE scopes in play rather than one, and
 * which one a function needs is a property of the function:
 *
 *   withTenant()          — everything the dashboard and the emitter do
 *   withApiKeyScope()     — `findKeyByHash` and `recordKeyUsage`, and only those
 *   withRetryWorkerScope()— the four functions the cron worker calls
 *
 * Calling one under the wrong scope does not leak; it returns nothing, because
 * all three policies fail closed. But it does look like "the key is invalid"
 * rather than "the caller used the wrong door", so each function says which
 * one it wants.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────────────────────

const iso = (v: unknown) =>
  v == null ? null : new Date(String(v)).toISOString();

/**
 * A timestamp on its way INTO a query.
 *
 * postgres-js binds parameters itself and cannot serialize a JS `Date` — it
 * throws `ERR_INVALID_ARG_TYPE` from the driver, under a Drizzle wrapper that
 * reports it as a failed query rather than as a bad argument. Every raw-SQL
 * repository here passes `.toISOString()` with an explicit `::timestamptz`
 * for that reason.
 */
const stamp = (v: Date | string | null | undefined) =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

export interface AuthenticatedKey {
  id: string;
  companyId: string;
  name: string;
  connectorType: string;
  scopes: string[];
  environment: string;
  isActive: boolean;
  expiresAt: string | null;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  createdById: string | null;
  createdByName: string | null;
}

/**
 * `scopes` arrives from postgres-js as a JS array already — it is a real
 * `integration_scope[]`, not a delimited string. Guarded anyway: an empty
 * array and a null are the same answer here, and the scope check must not
 * throw on the difference.
 */
const toScopes = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : [];

function toAuthenticatedKey(r: Record<string, unknown>): AuthenticatedKey {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    name: String(r.name),
    connectorType: String(r.connector_type),
    scopes: toScopes(r.scopes),
    environment: String(r.environment),
    isActive: Boolean(r.is_active),
    expiresAt: iso(r.expires_at),
    rateLimitPerMinute: Number(r.rate_limit_per_minute),
    rateLimitPerDay: Number(r.rate_limit_per_day),
    createdById: r.created_by_id == null ? null : String(r.created_by_id),
    createdByName: r.created_by_name == null ? null : String(r.created_by_name),
  };
}

/** The shape app/dashboard/integrations/api-keys already renders. */
function toScreenKey(r: Record<string, unknown>) {
  return {
    _id: String(r.id),
    id: String(r.id),
    name: String(r.name),
    displayKey: `${r.key_prefix}...${r.key_preview}`,
    connectorType: String(r.connector_type),
    scopes: toScopes(r.scopes),
    environment: String(r.environment),
    isActive: Boolean(r.is_active),
    expiresAt: iso(r.expires_at),
    lastUsedAt: iso(r.last_used_at),
    lastUsedIp: r.last_used_ip == null ? null : String(r.last_used_ip),
    totalRequests: Number(r.total_requests ?? 0),
    notes: String(r.notes ?? ""),
    createdAt: iso(r.created_at),
  };
}

/** The shape app/dashboard/integrations/webhooks already renders. */
function toScreenWebhook(r: Record<string, unknown>) {
  return {
    _id: String(r.id),
    id: String(r.id),
    name: String(r.name),
    url: String(r.url),
    events: Array.isArray(r.events) ? r.events.map(String) : [],
    connectorType: r.connector_type == null ? null : String(r.connector_type),
    suspended: Boolean(r.suspended),
    failureCount: Number(r.failure_count ?? 0),
    lastFailureAt: iso(r.last_failure_at),
    notes: String(r.notes ?? ""),
    createdAt: iso(r.created_at),
  };
}

/** The shape app/dashboard/integrations/logs already renders. */
function toScreenLog(r: Record<string, unknown>) {
  return {
    _id: String(r.id),
    id: String(r.id),
    direction: String(r.direction),
    event: String(r.event),
    connectorType: r.connector_type == null ? null : String(r.connector_type),
    externalRef: r.external_ref == null ? null : String(r.external_ref),
    internalRef: r.internal_ref == null ? null : String(r.internal_ref),
    status: String(r.status),
    error: r.error == null ? null : String(r.error),
    requestIp: r.request_ip == null ? null : String(r.request_ip),
    attempts: Number(r.attempts ?? 0),
    createdAt: iso(r.created_at),
    processedAt: iso(r.processed_at),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Keys — authentication path (withApiKeyScope)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a bearer token's hash to the key it names.
 *
 * MUST run under `withApiKeyScope(keyHash, ...)`. The `key_hash = ...` in the
 * WHERE clause below is therefore redundant with the policy, and stays anyway:
 * the policy is the guarantee, the predicate is what uses the unique index.
 *
 * Returns null for a hash that names nothing — which is also what a hash
 * scoped to a DIFFERENT key returns, so there is no way to use this to
 * enumerate.
 */
export async function findKeyByHash(
  tx: Tx,
  keyHash: string,
): Promise<AuthenticatedKey | null> {
  const rows = await tx.execute(sql`
    SELECT id, company_id, name, connector_type, scopes, environment,
           is_active, expires_at, rate_limit_per_minute, rate_limit_per_day,
           created_by_id, created_by_name
      FROM integration_keys
     WHERE key_hash = ${keyHash}
     LIMIT 1
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  return row ? toAuthenticatedKey(row) : null;
}

/**
 * Stamp usage on the way in. Also under `withApiKeyScope`.
 *
 * The Mongo version is fire-and-forget with `.catch(() => {})`, and that
 * property is kept at the CALLER — a failed counter update must not refuse a
 * request that is otherwise good. What is not kept is doing it as a second
 * round trip that nothing waits for: this runs inside the same transaction as
 * the lookup, so authentication is one query pair rather than a query plus an
 * orphaned promise racing the response.
 */
export async function recordKeyUsage(
  tx: Tx,
  keyHash: string,
  ip: string | null,
): Promise<void> {
  await tx.execute(sql`
    UPDATE integration_keys
       SET last_used_at   = now(),
           last_used_ip   = ${ip},
           total_requests = total_requests + 1,
           updated_at     = now()
     WHERE key_hash = ${keyHash}
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Keys — admin path (withTenant)
// ─────────────────────────────────────────────────────────────────────────────

export async function createIntegrationKey(
  tx: Tx,
  companyId: string,
  input: {
    name: string;
    keyHash: string;
    keyPreview: string;
    keyPrefix: string;
    connectorType: string;
    scopes: string[];
    environment: string;
    notes?: string;
    expiresAt?: Date | null;
    createdById?: string | null;
    createdByName?: string | null;
  },
) {
  /**
   * `= ANY(${array}::type[])` is the trap this codebase has been bitten by; an
   * INSERT of an array literal is the same problem in the other direction, so
   * it goes through `arrayOf` rather than being interpolated.
   */
  const scopes = input.scopes.length
    ? arrayOf(input.scopes, "integration_scope[]")
    : sql`'{}'::integration_scope[]`;

  const createdById = input.createdById ?? null;
  /**
   * The pair CHECK is a conditional on the id: a name without an id is the
   * shape it rules out. Deriving the name from the id here means a caller that
   * has one but not the other cannot write a half-actor.
   */
  const createdByName = createdById ? (input.createdByName ?? "Unknown") : null;

  const rows = await tx.execute(sql`
    INSERT INTO integration_keys (
      company_id, name, key_hash, key_preview, key_prefix,
      connector_type, scopes, environment, notes, expires_at,
      created_by_id, created_by_name
    ) VALUES (
      ${companyId}, ${input.name}, ${input.keyHash}, ${input.keyPreview},
      ${input.keyPrefix}, ${input.connectorType}::connector_type, ${scopes},
      ${input.environment}::integration_environment, ${input.notes ?? ""},
      ${stamp(input.expiresAt)}::timestamptz, ${createdById}, ${createdByName}
    )
    RETURNING id
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  return { id: String(row.id) };
}

/**
 * Revoke, not delete.
 *
 * `sync_logs.integration_key_id` is ON DELETE SET NULL precisely so that the
 * record of what a key did outlives the key — but a revoked key that is still
 * listed is also what lets an admin see that the connector they turned off is
 * still trying. Mongo does the same; this keeps it.
 */
export async function revokeIntegrationKey(tx: Tx, keyId: string) {
  const rows = await tx.execute(sql`
    UPDATE integration_keys
       SET is_active = false, updated_at = now()
     WHERE id = ${keyId}
     RETURNING id
  `);
  return (rows as unknown as unknown[]).length > 0;
}

export async function listIntegrationKeys(tx: Tx) {
  const rows = await tx.execute(sql`
    SELECT id, name, key_prefix, key_preview, connector_type, scopes,
           environment, is_active, expires_at, last_used_at, last_used_ip,
           total_requests, notes, created_at
      FROM integration_keys
     ORDER BY created_at DESC
  `);
  return (rows as unknown as Record<string, unknown>[]).map(toScreenKey);
}

/**
 * The dashboard's counters.
 *
 * Mongo runs two aggregations and reduces them in JavaScript. Both are
 * `COUNT`/`SUM` over an index-covered predicate, so they are one round trip
 * here — and `total_requests` sums in the database rather than arriving as
 * numeric strings that `reduce` would concatenate, which is the failure the
 * fulfilment repository documents at REQUEST_TOTALS.
 */
export async function getIntegrationStats(tx: Tx) {
  const rows = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM integration_keys)                    AS keys_total,
      (SELECT count(*)::int FROM integration_keys WHERE is_active)    AS keys_active,
      (SELECT COALESCE(SUM(total_requests), 0)::bigint
         FROM integration_keys)                                       AS keys_requests,
      (SELECT count(*)::int FROM sync_logs
        WHERE status = 'processed')                                   AS logs_processed,
      (SELECT count(*)::int FROM sync_logs
        WHERE status = 'failed')                                      AS logs_failed,
      (SELECT count(*)::int FROM sync_logs
        WHERE status IN ('received', 'processing'))                   AS logs_pending
  `);
  const r = (rows as unknown as Record<string, unknown>[])[0] ?? {};
  return {
    keys: {
      total: Number(r.keys_total ?? 0),
      active: Number(r.keys_active ?? 0),
      totalRequests: Number(r.keys_requests ?? 0),
    },
    logs: {
      processed: Number(r.logs_processed ?? 0),
      failed: Number(r.logs_failed ?? 0),
      pending: Number(r.logs_pending ?? 0),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook subscriptions (withTenant)
// ─────────────────────────────────────────────────────────────────────────────

export async function createWebhookSubscription(
  tx: Tx,
  companyId: string,
  input: {
    name: string;
    url: string;
    events: string[];
    secret: string;
    connectorType?: string | null;
    notes?: string;
    createdById?: string | null;
    createdByName?: string | null;
  },
) {
  const events = input.events.length
    ? arrayOf(input.events, "text[]")
    : sql`ARRAY['*']::text[]`;

  const createdById = input.createdById ?? null;
  const createdByName = createdById ? (input.createdByName ?? "Unknown") : null;

  const rows = await tx.execute(sql`
    INSERT INTO webhook_subscriptions (
      company_id, name, url, events, secret, connector_type, notes,
      created_by_id, created_by_name
    ) VALUES (
      ${companyId}, ${input.name}, ${input.url}, ${events}, ${input.secret},
      ${input.connectorType ?? null}::connector_type, ${input.notes ?? ""},
      ${createdById}, ${createdByName}
    )
    RETURNING id
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  return { id: String(row.id) };
}

export async function deactivateWebhookSubscription(tx: Tx, id: string) {
  const rows = await tx.execute(sql`
    UPDATE webhook_subscriptions
       SET is_active = false, updated_at = now()
     WHERE id = ${id}
     RETURNING id
  `);
  return (rows as unknown as unknown[]).length > 0;
}

export async function resumeWebhookSubscription(tx: Tx, id: string) {
  const rows = await tx.execute(sql`
    UPDATE webhook_subscriptions
       SET suspended = false, failure_count = 0, last_failure_at = NULL,
           updated_at = now()
     WHERE id = ${id}
     RETURNING id
  `);
  return (rows as unknown as unknown[]).length > 0;
}

export async function listWebhookSubscriptions(tx: Tx) {
  const rows = await tx.execute(sql`
    SELECT id, name, url, events, connector_type, suspended, failure_count,
           last_failure_at, notes, created_at
      FROM webhook_subscriptions
     WHERE is_active
     ORDER BY created_at DESC
  `);
  return (rows as unknown as Record<string, unknown>[]).map(toScreenWebhook);
}

/**
 * One subscription with its secret, for a route that needs to show or rotate
 * it. Kept apart from the list deliberately — the list is what a page renders,
 * and a signing secret has no business being in a payload sent to a browser.
 */
export async function getWebhookSubscriptionForDelivery(tx: Tx, id: string) {
  const rows = await tx.execute(sql`
    SELECT id, company_id, name, url, events, secret, connector_type,
           failure_count, suspended, is_active
      FROM webhook_subscriptions
     WHERE id = ${id}
     LIMIT 1
  `);
  return (rows as unknown as Record<string, unknown>[])[0] ?? null;
}

/**
 * The subscriptions an event should be delivered to.
 *
 * The Mongo query this replaces is three `$or` clauses that had to be nested
 * inside an explicit `$and`, with a comment explaining that spreading a second
 * `$or` silently overwrites the first — a bug the shape of the query language
 * invites. Here the event match is `&&` against a literal array of the three
 * patterns that can name this event, and the connector match is a plain OR.
 *
 * `is_active AND NOT suspended` matches the partial index, so a company with a
 * long tail of revoked subscriptions does not pay for them on every emit.
 */
export async function listDeliverableSubscriptions(
  tx: Tx,
  event: string,
  connectorType: string | null,
) {
  const namespace = `${event.split(".")[0]}.*`;
  const patterns = arrayOf(["*", event, namespace], "text[]");

  const rows = await tx.execute(sql`
    SELECT id, company_id, name, url, events, secret, connector_type,
           failure_count, suspended
      FROM webhook_subscriptions
     WHERE is_active
       AND NOT suspended
       AND events && ${patterns}
       AND (
         ${connectorType}::connector_type IS NULL
         OR connector_type IS NULL
         OR connector_type = ${connectorType}::connector_type
       )
  `);
  return rows as unknown as Record<string, unknown>[];
}

/**
 * Trip or reset the circuit breaker.
 *
 * Reachable under BOTH the tenant scope (a first-attempt failure, inside the
 * emit) and the worker scope (a retry), which is why it takes no company id —
 * the policy that admitted the row is what decides which of those it was.
 */
export async function recordDeliverySuccess(tx: Tx, subscriptionId: string) {
  await tx.execute(sql`
    UPDATE webhook_subscriptions
       SET failure_count = 0, suspended = false, last_failure_at = NULL,
           updated_at = now()
     WHERE id = ${subscriptionId}
       AND (failure_count > 0 OR suspended)
  `);
}

/**
 * `failure_count + 1` computed IN THE DATABASE, not read-modify-written by the
 * caller. Two deliveries to the same subscription failing at once would
 * otherwise both read the same count and both write count+1, so five failures
 * would suspend nothing.
 */
export async function recordDeliveryFailure(
  tx: Tx,
  subscriptionId: string,
  suspendAfter: number,
) {
  const rows = await tx.execute(sql`
    UPDATE webhook_subscriptions
       SET failure_count  = failure_count + 1,
           last_failure_at = now(),
           suspended      = (failure_count + 1) >= ${suspendAfter},
           updated_at     = now()
     WHERE id = ${subscriptionId}
     RETURNING failure_count, suspended
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  return {
    failureCount: Number(row?.failure_count ?? 0),
    suspended: Boolean(row?.suspended),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync logs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The idempotency read BaseConnector makes before doing any work.
 *
 * Restricted to `processed`: a failed attempt must be retryable under the same
 * reference, which is the whole point of an external system resending. The
 * partial unique index enforces the same rule for the concurrent case that
 * this read cannot see.
 */
export async function findProcessedByExternalRef(
  tx: Tx,
  externalRef: string,
) {
  const rows = await tx.execute(sql`
    SELECT id, internal_ref, internal_id, result
      FROM sync_logs
     WHERE direction = 'inbound'
       AND external_ref = ${externalRef}
       AND status = 'processed'
     LIMIT 1
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  if (!row) return null;
  return {
    id: String(row.id),
    internalRef: row.internal_ref == null ? null : String(row.internal_ref),
    internalId: row.internal_id == null ? null : String(row.internal_id),
    result: row.result ?? null,
  };
}

export async function createSyncLog(
  tx: Tx,
  companyId: string,
  input: {
    direction: "inbound" | "outbound";
    event: string;
    status?: string;
    connectorType?: string | null;
    integrationKeyId?: string | null;
    webhookSubscriptionId?: string | null;
    externalRef?: string | null;
    rawPayload?: unknown;
    requestIp?: string | null;
    requestId?: string | null;
    webhookUrl?: string | null;
  },
) {
  const rows = await tx.execute(sql`
    INSERT INTO sync_logs (
      company_id, direction, event, status, connector_type,
      integration_key_id, webhook_subscription_id, external_ref,
      raw_payload, request_ip, request_id, webhook_url
    ) VALUES (
      ${companyId}, ${input.direction}::sync_direction, ${input.event},
      ${input.status ?? "processing"}::sync_status,
      ${input.connectorType ?? null}::connector_type,
      ${input.integrationKeyId ?? null}, ${input.webhookSubscriptionId ?? null},
      ${input.externalRef ?? null},
      ${input.rawPayload == null ? null : JSON.stringify(input.rawPayload)}::jsonb,
      ${input.requestIp ?? null}, ${input.requestId ?? null},
      ${input.webhookUrl ?? null}
    )
    RETURNING id, created_at
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  return { id: String(row.id), createdAt: iso(row.created_at) as string };
}

export async function markSyncLogProcessed(
  tx: Tx,
  logId: string,
  input: {
    internalRef?: string | null;
    internalId?: string | null;
    mappedPayload?: unknown;
    result?: unknown;
  },
) {
  await tx.execute(sql`
    UPDATE sync_logs
       SET status         = 'processed',
           internal_ref   = ${input.internalRef ?? null},
           internal_id    = ${input.internalId ?? null},
           mapped_payload = ${input.mappedPayload == null ? null : JSON.stringify(input.mappedPayload)}::jsonb,
           result         = ${input.result == null ? null : JSON.stringify(input.result)}::jsonb,
           processed_at   = now(),
           next_retry_at  = NULL,
           updated_at     = now()
     WHERE id = ${logId}
  `);
}

export async function markSyncLogFailed(
  tx: Tx,
  logId: string,
  error: string,
) {
  await tx.execute(sql`
    UPDATE sync_logs
       SET status = 'failed', error = ${error}, next_retry_at = NULL,
           updated_at = now()
     WHERE id = ${logId}
  `);
}

/**
 * Record the outcome of one webhook delivery attempt.
 *
 * One statement, not a read-modify-write of a fetched document — the Mongo
 * version mutates a hydrated model and calls `.save()`, which rewrites every
 * field it is holding, including ones another worker may have changed since.
 *
 * The `sync_logs_retrying_has_next_retry` CHECK is what keeps the two
 * arguments honest: a caller that passes `status: "retrying"` with no
 * `nextRetryAt` is refused by the database rather than parking a delivery
 * nothing will ever claim.
 */
export async function recordDeliveryAttempt(
  tx: Tx,
  logId: string,
  input: {
    status: "processed" | "failed" | "retrying";
    attempts: number;
    httpStatus: number | null;
    responseBody?: string | null;
    error?: string | null;
    nextRetryAt?: Date | null;
    result?: unknown;
  },
) {
  await tx.execute(sql`
    UPDATE sync_logs
       SET status          = ${input.status}::sync_status,
           attempts        = ${input.attempts},
           last_attempt_at = now(),
           http_status     = ${input.httpStatus},
           response_body   = ${input.responseBody ?? null},
           error           = ${input.error ?? null},
           next_retry_at   = ${stamp(input.nextRetryAt)}::timestamptz,
           result          = ${input.result == null ? null : JSON.stringify(input.result)}::jsonb,
           processed_at    = CASE WHEN ${input.status} = 'processed'
                                  THEN now() ELSE processed_at END,
           updated_at      = now()
     WHERE id = ${logId}
  `);
}

export async function listRecentSyncLogs(tx: Tx, limit = 20) {
  const capped = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const rows = await tx.execute(sql`
    SELECT id, direction, event, connector_type, external_ref, internal_ref,
           status, error, request_ip, attempts, created_at, processed_at
      FROM sync_logs
     ORDER BY created_at DESC
     LIMIT ${capped}
  `);
  return (rows as unknown as Record<string, unknown>[]).map(toScreenLog);
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry worker (withRetryWorkerScope)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Claim a batch of due deliveries.
 *
 * The claim and the read are ONE STATEMENT, which is the difference that
 * matters. Mongo finds the due rows, then updates them to 'processing' in a
 * second call — and two workers whose cron ticks overlap both find the same
 * batch in the gap between the two, so a subscriber gets the delivery twice.
 *
 * `FOR UPDATE SKIP LOCKED` in the subquery means a second worker running
 * concurrently steps over the rows this one has taken and claims the next
 * ones, rather than blocking on them or duplicating them.
 *
 * The tenant filter is absent because THE POLICY IS THE FILTER: under the
 * worker scope this table shows outbound rows in flight and nothing else, for
 * every company. `company_id` comes back so each delivery can be logged
 * against the tenant it belongs to.
 */
export async function claimDueRetries(tx: Tx, limit = 50) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await tx.execute(sql`
    UPDATE sync_logs
       SET status = 'processing', next_retry_at = NULL, updated_at = now()
     WHERE id IN (
       SELECT id FROM sync_logs
        WHERE status = 'retrying'
          AND next_retry_at IS NOT NULL
          AND next_retry_at <= now()
          AND webhook_subscription_id IS NOT NULL
        ORDER BY next_retry_at
        LIMIT ${capped}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, company_id, webhook_subscription_id, event, raw_payload,
               request_id, attempts, created_at
  `);
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    companyId: String(r.company_id),
    webhookSubscriptionId: String(r.webhook_subscription_id),
    event: String(r.event),
    rawPayload: r.raw_payload ?? null,
    requestId: r.request_id == null ? null : String(r.request_id),
    attempts: Number(r.attempts ?? 0),
    createdAt: iso(r.created_at) as string,
  }));
}

/**
 * The subscription a claimed delivery is for, under the worker scope.
 *
 * Returns null for a subscription that has since been revoked — the policy
 * only admits active ones — which the worker reports as `skipped`. A suspended
 * one still comes back, because "suspended" is a different outcome from "gone"
 * and the worker records it as such.
 */
export async function getSubscriptionForRetry(tx: Tx, subscriptionId: string) {
  const rows = await tx.execute(sql`
    SELECT id, company_id, url, secret, suspended, connector_type
      FROM webhook_subscriptions
     WHERE id = ${subscriptionId}
     LIMIT 1
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  if (!row) return null;
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    url: String(row.url),
    secret: String(row.secret),
    suspended: Boolean(row.suspended),
    connectorType:
      row.connector_type == null ? null : String(row.connector_type),
  };
}

export async function markSyncLogSkipped(
  tx: Tx,
  logId: string,
  reason: string,
) {
  await tx.execute(sql`
    UPDATE sync_logs
       SET status = 'skipped', error = ${reason}, next_retry_at = NULL,
           updated_at = now()
     WHERE id = ${logId}
  `);
}

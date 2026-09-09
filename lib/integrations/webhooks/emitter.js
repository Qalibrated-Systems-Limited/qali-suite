import crypto from "crypto";
import { withTenant, withRetryWorkerScope } from "@/app/db/client";
import {
  listDeliverableSubscriptions,
  createSyncLog,
  recordDeliveryAttempt,
  recordDeliverySuccess,
  recordDeliveryFailure,
  claimDueRetries,
  getSubscriptionForRetry,
  markSyncLogSkipped,
} from "@/app/db/repositories/integrations";

// ============================================
// WEBHOOK EMITTER
// Call emitWebhookEvent() from any server action
// or route handler when something meaningful happens.
//
// Usage:
//   await emitWebhookEvent({
//     companyId: "...",   // the tenant's Postgres uuid
//     event: "invoice.created",
//     payload: { invoiceId: "...", total: 5000 },
//   });
//
// Fire-and-forget safe — errors are caught and logged,
// never thrown back to the caller.
//
// Retry strategy: failures are persisted to sync_logs
// with next_retry_at set. The cron worker at
// /api/cron/webhook-retry processes due retries.
// No in-process setTimeout — safe across restarts.
// ============================================

/**
 * On Postgres since 0102.
 *
 * ── NO TRANSACTION IS HELD ACROSS AN HTTP CALL ────────────────────────────
 *
 * This is the thing that shapes the whole file, and the thing a direct
 * transcription of the Mongo version would have got wrong.
 *
 * Mongo has no transaction here — every `.save()` is its own round trip — so
 * the code interleaves database writes and `fetch()` freely. Wrapping that
 * shape in `withTenant` would hold a pooled connection open for the duration
 * of a delivery to a third party: up to DELIVERY_TIMEOUT_MS, times the number
 * of subscriptions, on a pool of ten. A single slow subscriber would then be
 * indistinguishable from the database being down, for every other request on
 * the instance.
 *
 * So each emission is three phases, and the middle one holds nothing:
 *
 *   1. READ + CLAIM   one short transaction: which subscriptions match, and a
 *                     sync_logs row per delivery, written as 'processing'
 *   2. DELIVER        no transaction, no connection — just fetch()
 *   3. RECORD         one short transaction per delivery: the outcome and the
 *                     circuit breaker
 *
 * The retry worker below has exactly the same three phases, for the same
 * reason.
 */

const DELIVERY_TIMEOUT_MS = 10_000; // 10 s per attempt
const MAX_ATTEMPTS = 5;

// Exponential backoff delays (ms): 1m, 5m, 15m, 1h, 4h
const RETRY_DELAYS = [60_000, 300_000, 900_000, 3_600_000, 14_400_000];

// Circuit breaker: suspend after this many consecutive failures
const SUSPEND_AFTER = 5;

// ── Signing ───────────────────────────────────────────────

function signPayload(secret, body) {
  return (
    "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex")
  );
}

/**
 * The delivered body.
 *
 * Built in one place because a RETRY MUST REPRODUCE IT BYTE FOR BYTE — the
 * signature is over the body, so a retry that rebuilt it with a fresh
 * timestamp would present a valid signature for a payload the subscriber has
 * already seen under a different one, and any subscriber deduplicating on
 * `id` would treat the two as different events.
 *
 * `createdAt` is therefore the log row's own creation time on every attempt,
 * not `new Date()`.
 */
function buildBody(requestId, event, createdAt, payload) {
  return JSON.stringify({
    id: requestId,
    event,
    createdAt:
      createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
    data: payload,
  });
}

// ── Core delivery ─────────────────────────────────────────

/**
 * Attempt a single HTTP delivery to a subscriber URL.
 * Returns { ok, status, body } — never throws.
 */
async function attemptDelivery(url, body, signature) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-QaliSuite-Signature": signature,
        "X-QaliSuite-Event": "webhook",
        "User-Agent": "QaliSuite-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
    });

    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err.name === "AbortError" ? "timeout" : err.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Phase 3 — write down what happened, and move the circuit breaker.
 *
 * `runInScope` is the caller's transaction opener: `withTenant(companyId, …)`
 * for a first attempt, `withRetryWorkerScope(…)` for a retry. The two paths do
 * identical work under different policies, which is why this takes the opener
 * rather than deciding for itself.
 */
async function recordOutcome(runInScope, { logId, subscriptionId, result, attemptNumber }) {
  if (result.ok) {
    await runInScope(async (tx) => {
      await recordDeliveryAttempt(tx, logId, {
        status: "processed",
        attempts: attemptNumber,
        httpStatus: result.status,
        responseBody: result.body,
        error: null,
        nextRetryAt: null,
        result: { response: result.body, attempts: attemptNumber },
      });
      await recordDeliverySuccess(tx, subscriptionId);
    });
    return "processed";
  }

  if (attemptNumber >= MAX_ATTEMPTS) {
    await runInScope(async (tx) => {
      await recordDeliveryAttempt(tx, logId, {
        status: "failed",
        attempts: attemptNumber,
        httpStatus: result.status,
        responseBody: result.body,
        error: `Failed after ${MAX_ATTEMPTS} attempts. Last: HTTP ${result.status} — ${result.body}`,
        nextRetryAt: null,
      });
      /**
       * The count is incremented IN SQL, not read here and written back. Two
       * deliveries to the same subscription failing at once would otherwise
       * both read the same value and both write value+1, so five failures
       * would never reach the threshold and a dead endpoint would never be
       * suspended.
       */
      await recordDeliveryFailure(tx, subscriptionId, SUSPEND_AFTER);
    });
    return "failed";
  }

  const delay = RETRY_DELAYS[attemptNumber - 1] ?? 60_000;
  await runInScope((tx) =>
    recordDeliveryAttempt(tx, logId, {
      status: "retrying",
      attempts: attemptNumber,
      httpStatus: result.status,
      responseBody: result.body,
      error: `Attempt ${attemptNumber} failed: HTTP ${result.status} — ${result.body}`,
      nextRetryAt: new Date(Date.now() + delay),
    }),
  );
  return "retrying";
}

// ── Public API ────────────────────────────────────────────

/**
 * Emit a webhook event to all matching active subscriptions.
 * Fire-and-forget — never throws to the caller.
 *
 * @param {object}  args
 * @param {string}  args.companyId  The tenant's POSTGRES uuid.
 */
export async function emitWebhookEvent({
  companyId,
  event,
  payload,
  connectorType = null,
}) {
  _emit({ companyId, event, payload, connectorType }).catch((err) => {
    console.error("[webhook-emitter] unhandled error:", err);
  });
}

async function _emit({ companyId, event, payload, connectorType }) {
  if (!companyId) {
    console.error("[webhook-emitter] no companyId; dropping", event);
    return;
  }

  const requestId = crypto.randomUUID();

  // ── Phase 1: read the subscriptions and claim a log row for each ────────
  const deliveries = await withTenant(companyId, async (tx) => {
    /**
     * One query, where Mongo needed three `$or` clauses nested inside an
     * explicit `$and` — with a comment explaining that spreading a second
     * `$or` silently overwrites the first, which is a bug the query language
     * invites rather than one anybody chose.
     */
    const subs = await listDeliverableSubscriptions(tx, event, connectorType);
    if (!subs.length) return [];

    const rows = [];
    for (const sub of subs) {
      const log = await createSyncLog(tx, companyId, {
        direction: "outbound",
        event,
        status: "processing",
        connectorType: sub.connector_type ?? null,
        webhookSubscriptionId: String(sub.id),
        externalRef: `webhook:${sub.id}:${requestId}`,
        rawPayload: payload,
        requestId,
        webhookUrl: String(sub.url),
      });
      rows.push({
        logId: log.id,
        createdAt: log.createdAt,
        subscriptionId: String(sub.id),
        url: String(sub.url),
        secret: String(sub.secret),
      });
    }
    return rows;
  });

  if (!deliveries.length) return;

  // ── Phase 2 + 3: deliver outside any transaction, then record ───────────
  const runInScope = (fn) => withTenant(companyId, fn);

  await Promise.allSettled(
    deliveries.map(async (d) => {
      const body = buildBody(requestId, event, d.createdAt, payload);
      const result = await attemptDelivery(
        d.url,
        body,
        signPayload(d.secret, body),
      );
      await recordOutcome(runInScope, {
        logId: d.logId,
        subscriptionId: d.subscriptionId,
        result,
        attemptNumber: 1,
      });
    }),
  );
}

// ── Retry worker (called by cron route) ───────────────────

/**
 * Process all webhook deliveries that are due for retry.
 * Call this from /api/cron/webhook-retry on a schedule (e.g. every minute).
 *
 * Runs under `withRetryWorkerScope`, not `withoutTenantScope`: it genuinely is
 * cross-tenant, but it has no business reading anything except outbound
 * deliveries in flight, and 0102 writes that restriction into the policy
 * rather than trusting the queries below to carry it.
 *
 * @returns {{ processed: number, failed: number, skipped: number }}
 */
export async function processDueRetries() {
  // ── Phase 1: claim ──────────────────────────────────────────────────────
  /**
   * The claim is ONE STATEMENT — an UPDATE … WHERE id IN (SELECT … FOR UPDATE
   * SKIP LOCKED) … RETURNING. Mongo does it as a find followed by an
   * updateMany, and two workers whose ticks overlap both see the same batch in
   * the gap between the two calls, so a subscriber receives the delivery
   * twice. Duplicate webhook deliveries are the failure this replaces.
   */
  const due = await withRetryWorkerScope((tx) => claimDueRetries(tx, 50));
  if (!due.length) return { processed: 0, failed: 0, skipped: 0 };

  let processed = 0,
    failed = 0,
    skipped = 0;

  const runInScope = (fn) => withRetryWorkerScope(fn);

  await Promise.allSettled(
    due.map(async (log) => {
      const subscription = await withRetryWorkerScope((tx) =>
        getSubscriptionForRetry(tx, log.webhookSubscriptionId),
      );

      /**
       * Null means revoked — the worker's policy only admits active
       * subscriptions — which is a different outcome from suspended, and is
       * recorded as one. Both leave the row terminal so it is not reclaimed.
       */
      if (!subscription) {
        await withRetryWorkerScope((tx) =>
          markSyncLogSkipped(tx, log.id, "Subscription no longer active"),
        );
        skipped++;
        return;
      }

      if (subscription.suspended) {
        await withRetryWorkerScope((tx) =>
          recordDeliveryAttempt(tx, log.id, {
            status: "failed",
            attempts: log.attempts,
            httpStatus: null,
            error: "Subscription suspended",
            nextRetryAt: null,
          }),
        );
        failed++;
        return;
      }

      // ── Phase 2: deliver, holding nothing ─────────────────────────────
      const body = buildBody(
        log.requestId,
        log.event,
        log.createdAt,
        log.rawPayload,
      );
      const result = await attemptDelivery(
        subscription.url,
        body,
        signPayload(subscription.secret, body),
      );

      // ── Phase 3: record ───────────────────────────────────────────────
      const outcome = await recordOutcome(runInScope, {
        logId: log.id,
        subscriptionId: subscription.id,
        result,
        attemptNumber: log.attempts + 1,
      });

      if (outcome === "processed") processed++;
      else if (outcome === "failed") failed++;
    }),
  );

  return { processed, failed, skipped };
}

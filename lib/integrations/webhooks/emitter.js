import crypto from "crypto";
import dbConnect from "@/app/config/dbConnect";
import WebhookSubscription from "@/app/models/webhookSubscription";
import SyncLog from "@/app/models/syncLog";

// ============================================
// WEBHOOK EMITTER
// Call emitWebhookEvent() from any server action
// or route handler when something meaningful happens.
//
// Usage:
//   await emitWebhookEvent({
//     companyId: "...",
//     event: "invoice.created",
//     payload: { invoiceId: "...", total: 5000 },
//   });
//
// Fire-and-forget safe — errors are caught and logged,
// never thrown back to the caller.
//
// Retry strategy: failures are persisted to SyncLog
// with nextRetryAt set. The cron worker at
// /api/cron/webhook-retry processes due retries.
// No in-process setTimeout — safe across restarts.
// ============================================

const DELIVERY_TIMEOUT_MS = 10_000; // 10 s per attempt
const MAX_ATTEMPTS = 5;

// Exponential backoff delays (ms): 1m, 5m, 15m, 1h, 4h
const RETRY_DELAYS = [60_000, 300_000, 900_000, 3_600_000, 14_400_000];

// Circuit breaker: suspend after this many consecutive failures
const SUSPEND_AFTER = 5;

// ── Signing ───────────────────────────────────────────────

function signPayload(secret, body) {
  return (
    "sha256=" +
    crypto.createHmac("sha256", secret).update(body).digest("hex")
  );
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

// ── Attempt + schedule next retry ─────────────────────────

/**
 * Make one delivery attempt for a SyncLog entry.
 * On success: marks processed, resets circuit breaker.
 * On failure: schedules next retry via nextRetryAt (if attempts remain)
 *             or marks failed + increments circuit breaker.
 *
 * @param {import("mongoose").Document} logDoc - Mongoose SyncLog document
 * @param {object} subscription - Plain subscription object (lean)
 * @param {string} body - Pre-built JSON string to deliver
 * @param {string} signature - HMAC signature header value
 * @param {number} attemptNumber - 1-based attempt counter
 */
async function attemptAndSchedule(logDoc, subscription, body, signature, attemptNumber) {
  const result = await attemptDelivery(subscription.url, body, signature);

  logDoc.attempts = attemptNumber;
  logDoc.lastAttemptAt = new Date();
  logDoc.httpStatus = result.status;

  if (result.ok) {
    logDoc.status = "processed";
    logDoc.result = { response: result.body, attempts: attemptNumber };
    logDoc.processedAt = new Date();
    logDoc.nextRetryAt = null;
    await logDoc.save();

    if (subscription.failureCount > 0 || subscription.suspended) {
      await WebhookSubscription.updateOne(
        { _id: subscription._id },
        { $set: { failureCount: 0, suspended: false, lastFailureAt: null } }
      );
    }
    return;
  }

  if (attemptNumber >= MAX_ATTEMPTS) {
    logDoc.status = "failed";
    logDoc.error = `Failed after ${MAX_ATTEMPTS} attempts. Last: HTTP ${result.status} — ${result.body}`;
    logDoc.nextRetryAt = null;
    await logDoc.save();

    const newFailureCount = (subscription.failureCount || 0) + 1;
    await WebhookSubscription.updateOne(
      { _id: subscription._id },
      {
        $set: {
          failureCount: newFailureCount,
          lastFailureAt: new Date(),
          suspended: newFailureCount >= SUSPEND_AFTER,
        },
      }
    );
    return;
  }

  // Write retry intent to DB — the cron worker will pick this up
  const delay = RETRY_DELAYS[attemptNumber - 1] ?? 60_000;
  logDoc.status = "retrying";
  logDoc.nextRetryAt = new Date(Date.now() + delay);
  logDoc.error = `Attempt ${attemptNumber} failed: HTTP ${result.status} — ${result.body}`;
  await logDoc.save();
}

// ── Initial delivery (first attempt) ──────────────────────

async function startDelivery(subscription, event, payload, requestId) {
  const body = JSON.stringify({
    id: requestId,
    event,
    createdAt: new Date().toISOString(),
    data: payload,
  });
  const signature = signPayload(subscription.secret, body);

  const logDoc = await SyncLog.create({
    companyId: subscription.companyId,
    direction: "outbound",
    event,
    connectorType: subscription.connectorType || null,
    externalRef: `webhook:${subscription._id}:${requestId}`,
    rawPayload: payload,
    requestId,  // stored so retries can rebuild the same body
    status: "processing",
    attempts: 0,
    webhookSubscriptionId: subscription._id,
    webhookUrl: subscription.url,
  });

  await attemptAndSchedule(logDoc, subscription, body, signature, 1);
}

// ── Public API ────────────────────────────────────────────

/**
 * Emit a webhook event to all matching active subscriptions.
 * Fire-and-forget — never throws to the caller.
 */
export async function emitWebhookEvent({ companyId, event, payload, connectorType = null }) {
  _emit({ companyId, event, payload, connectorType }).catch((err) => {
    console.error("[webhook-emitter] unhandled error:", err);
  });
}

async function _emit({ companyId, event, payload, connectorType }) {
  await dbConnect();

  // Build query with explicit $and so both $or clauses are preserved.
  // A plain spread of a second $or would silently overwrite the first one.
  const eventFilter = {
    $or: [
      { events: "*" },
      { events: event },
      // Wildcard namespace: "invoice.*" matches "invoice.created"
      { events: event.split(".")[0] + ".*" },
    ],
  };

  const connectorFilter = connectorType
    ? { $or: [{ connectorType }, { connectorType: null }] }
    : null;

  const query = {
    companyId,
    isActive: true,
    suspended: false,
    ...(connectorFilter
      ? { $and: [eventFilter, connectorFilter] }
      : eventFilter),
  };

  const subscriptions = await WebhookSubscription.find(query).lean();
  if (!subscriptions.length) return;

  const requestId = crypto.randomUUID();

  await Promise.allSettled(
    subscriptions.map((sub) => startDelivery(sub, event, payload, requestId))
  );
}

// ── Retry worker (called by cron route) ───────────────────

/**
 * Process all webhook deliveries that are due for retry.
 * Call this from /api/cron/webhook-retry on a schedule (e.g. every minute).
 *
 * @returns {{ processed: number, failed: number, skipped: number }}
 */
export async function processDueRetries() {
  await dbConnect();

  const now = new Date();

  // Claim a batch atomically to avoid double-processing across workers
  const dueLogs = await SyncLog.find({
    direction: "outbound",
    status: "retrying",
    nextRetryAt: { $lte: now },
    webhookSubscriptionId: { $ne: null },
  })
    .limit(50)
    .lean();

  if (!dueLogs.length) return { processed: 0, failed: 0, skipped: 0 };

  // Mark them all as "processing" before we start to prevent double-run
  const logIds = dueLogs.map((l) => l._id);
  await SyncLog.updateMany(
    { _id: { $in: logIds }, status: "retrying" },
    { $set: { status: "processing", nextRetryAt: null } }
  );

  let processed = 0, failed = 0, skipped = 0;

  await Promise.allSettled(
    dueLogs.map(async (log) => {
      const subscription = await WebhookSubscription.findOne({
        _id: log.webhookSubscriptionId,
        isActive: true,
      }).lean();

      if (!subscription) {
        await SyncLog.updateOne(
          { _id: log._id },
          { $set: { status: "skipped", error: "Subscription no longer active" } }
        );
        skipped++;
        return;
      }

      if (subscription.suspended) {
        await SyncLog.updateOne(
          { _id: log._id },
          { $set: { status: "failed", error: "Subscription suspended" } }
        );
        failed++;
        return;
      }

      // Rebuild the exact same body as the original emission so
      // the requestId and createdAt are stable across retry attempts.
      const body = JSON.stringify({
        id: log.requestId,
        event: log.event,
        createdAt: log.createdAt,
        data: log.rawPayload,
      });
      const signature = signPayload(subscription.secret, body);

      const logDoc = await SyncLog.findById(log._id);
      if (!logDoc) { skipped++; return; }

      await attemptAndSchedule(logDoc, subscription, body, signature, log.attempts + 1);

      if (logDoc.status === "processed") processed++;
      else if (logDoc.status === "failed") failed++;
    })
  );

  return { processed, failed, skipped };
}

// ============================================
// API KEY AUTH MIDDLEWARE
// Used by every /api/v1/* route handler.
// Resolves the bearer token → company context.
//
// Usage in a route:
//   const ctx = await apiKeyAuth(request);
//   if (!ctx.ok) return ctx.response;
//   const { companyId, connectorType, scopes } = ctx;
//
// Most routes do not call this directly — they use withApiKeyTenant
// (app/db/apiTenant.ts), which calls it and then opens the transaction.
// ============================================

import { withApiKeyScope } from "@/app/db/client";
import {
  findKeyByHash,
  recordKeyUsage,
} from "@/app/db/repositories/integrations";
import {
  hashKey,
  extractBearerToken,
  verifyHmacSignature,
  isTimestampFresh,
} from "../utils/keyUtils.js";
import { Errors } from "../utils/errors.js";

/**
 * On Postgres since 0102.
 *
 * This function is why that migration exists. Every /api/v1 request used to
 * open a MONGO connection to authenticate and then a POSTGRES transaction to
 * do the work — two stores on the hot path of an API whose whole promise is
 * that a truck at a gate does not wait, and a Mongo outage that took down
 * authentication for data Mongo did not hold.
 *
 * THE LOOKUP RUNS UNDER ITS OWN SCOPE. A request carrying a bearer token has
 * no company yet, so it cannot use `withTenant`; under the ordinary policy the
 * SELECT would match `company_id = NULL` and refuse every connector on the
 * estate. `withApiKeyScope` sets `app.api_key_hash`, and `integration_keys`
 * has a second policy that matches one row on it — the key whose plaintext the
 * caller is already holding. See Decision 1 in 0102.
 */

/**
 * In-memory rate limit store.
 * Maps keyHash → { count, windowStart }
 * Resets every 60 seconds per key.
 *
 * STILL IN MEMORY, deliberately, and still per-instance: moving it to Postgres
 * would put a write on the path of every request in order to police a limit
 * whose enforcement is already approximate across instances. Redis is the
 * upgrade when the limit needs to be exact.
 */
const rateLimitStore = new Map();

function checkRateLimit(keyHash, limitPerMinute) {
  const now = Date.now();
  const windowMs = 60_000;
  const entry = rateLimitStore.get(keyHash);

  if (!entry || now - entry.windowStart > windowMs) {
    rateLimitStore.set(keyHash, { count: 1, windowStart: now });
    return { allowed: true, remaining: limitPerMinute - 1 };
  }

  if (entry.count >= limitPerMinute) {
    const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  entry.count += 1;
  return { allowed: true, remaining: limitPerMinute - entry.count };
}

/**
 * Resolve an API key request → authenticated context.
 *
 * Returns either:
 *   { ok: true, companyId, keyId, connectorType, scopes, environment, key }
 *   { ok: false, response: NextResponse }
 */
export async function apiKeyAuth(request, options = {}) {
  const { requireScope = null, requireHmac = false } = options;

  // ── 1. Extract bearer token ───────────────────────────────
  const authHeader = request.headers.get("authorization");
  const token = extractBearerToken(authHeader);
  if (!token) return fail(Errors.missingKey());

  // ── 2. Validate HMAC if required ─────────────────────────
  if (requireHmac) {
    const timestamp = request.headers.get("x-timestamp");
    const signature = request.headers.get("x-signature");

    if (!timestamp || !signature) {
      return fail(Errors.invalidSignature());
    }
    if (!isTimestampFresh(timestamp)) {
      return fail(Errors.expiredTimestamp());
    }

    const body = await request.text();
    const url = new URL(request.url);
    const valid = verifyHmacSignature({
      method: request.method,
      path: url.pathname,
      timestamp,
      body,
      signature,
      secret: token, // The token itself is used as the HMAC secret in test
      // In production the secret is stored separately on the key record
    });
    if (!valid) return fail(Errors.invalidSignature());
  }

  // ── 3. Look up the hashed key ────────────────────────────
  const keyHash = hashKey(token);

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  let apiKey;
  try {
    apiKey = await withApiKeyScope(keyHash, async (tx) => {
      const key = await findKeyByHash(tx, keyHash);
      if (!key) return null;

      /**
       * Usage is stamped INSIDE the lookup transaction rather than as a
       * fire-and-forget update racing the response, which is what the Mongo
       * version did — an unawaited `updateOne(...).catch(() => {})` that a
       * serverless instance could be frozen before completing, so
       * `lastUsedAt` on a busy key was whatever survived.
       *
       * A key that is invalid, revoked or expired is not stamped: the checks
       * below run after this returns, and a rejected request is not a use.
       * That is a change from Mongo, which counted every attempt, including
       * ones it refused.
       */
      if (key.isActive && !(key.expiresAt && new Date() > new Date(key.expiresAt))) {
        await recordKeyUsage(tx, keyHash, ip);
      }
      return key;
    });
  } catch (err) {
    console.error("[apiKeyAuth] key lookup failed:", err);
    return fail(Errors.invalidKey());
  }

  if (!apiKey) return fail(Errors.invalidKey());
  if (!apiKey.isActive) return fail(Errors.revokedKey());
  if (apiKey.expiresAt && new Date() > new Date(apiKey.expiresAt))
    return fail(Errors.expiredKey());

  // ── 4. Plan gate — does this company have integration? ───
  // The gate is enforced at key CREATION time: an admin cannot issue a key
  // unless their plan includes "integration" (app/db/actions/integration-actions.ts,
  // which reads the subscription from Postgres rather than the session).
  // Revoking access on downgrade is a matter of deactivating the keys, not of
  // adding a subscription read to every request.

  // ── 5. Scope check ───────────────────────────────────────
  if (requireScope) {
    const scopes = apiKey.scopes || [];
    if (!scopes.includes(requireScope)) {
      return fail(Errors.forbiddenScope(requireScope));
    }
  }

  // ── 6. Rate limit ────────────────────────────────────────
  const limit = apiKey.rateLimitPerMinute ?? 60;
  const rl = checkRateLimit(keyHash, limit);
  if (!rl.allowed) {
    return fail(Errors.rateLimited(rl.retryAfter));
  }

  // ── 7. Return resolved context ───────────────────────────
  return {
    ok: true,
    /**
     * The company's POSTGRES uuid, directly — no longer a Mongo ObjectId that
     * apiTenant.ts then has to put through `resolveCompanyUuid`.
     */
    companyId: apiKey.companyId,
    keyId: apiKey.id,
    connectorType: apiKey.connectorType,
    scopes: apiKey.scopes,
    environment: apiKey.environment,
    keyName: apiKey.name,
    rateLimit: rl,
    /** Who the key acts on behalf of — the actor recorded on everything it writes. */
    createdBy: apiKey.createdById
      ? { id: apiKey.createdById, name: apiKey.createdByName }
      : null,
    key: apiKey,
  };
}

// ── Helper ───────────────────────────────────────────────
function fail(response) {
  return { ok: false, response };
}

// ============================================
// API KEY AUTH MIDDLEWARE
// Used by every /api/v1/* route handler.
// Resolves the bearer token → company context.
//
// Usage in a route:
//   const ctx = await apiKeyAuth(request);
//   if (!ctx.ok) return ctx.response;
//   const { companyId, connectorType, scopes } = ctx;
// ============================================

/**
 * In-memory rate limit store.
 * Maps keyHash → { count, windowStart }
 * Resets every 60 seconds per key.
 * For production at scale, swap this for Redis.
 */

import dbConnect from "@/app/config/dbConnect";
import IntegrationKey from "@/app/models/integrationKey";
import {
  hashKey,
  extractBearerToken,
  verifyHmacSignature,
  isTimestampFresh,
} from "../utils/keyUtils.js";
import { Errors } from "../utils/errors.js";
import { planIncludes } from "@/lib/plans";

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

  // ── 3. Look up the hashed key in the database ────────────
  await dbConnect();
  const keyHash = hashKey(token);

  const apiKey = await IntegrationKey.findOne({ keyHash }).lean();

  if (!apiKey) return fail(Errors.invalidKey());
  if (!apiKey.isActive) return fail(Errors.revokedKey());
  if (apiKey.expiresAt && new Date() > apiKey.expiresAt)
    return fail(Errors.expiredKey());

  // ── 4. Plan gate — does this company have integration? ───
  // company.plan is on the session for UI routes; for API routes
  // we check against the company record directly.
  // For now we trust the key being active as sufficient — plan gate
  // is enforced at key creation time (admin cannot create a key unless
  // their plan includes "integration"). The runtime check happens in
  // the key creation server action.

  // ── 5. Scope check ───────────────────────────────────────
  if (requireScope) {
    const scopes = apiKey.scopes || [];
    if (!scopes.includes(requireScope)) {
      return fail(Errors.forbiddenScope(requireScope));
    }
  }

  // ── 6. Rate limit ────────────────────────────────────────
  const limit = apiKey.rateLimit?.requestsPerMinute ?? 60;
  const rl = checkRateLimit(keyHash, limit);
  if (!rl.allowed) {
    return fail(Errors.rateLimited(rl.retryAfter));
  }

  // ── 7. Update usage stats (fire-and-forget, non-blocking) ─
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  IntegrationKey.updateOne(
    { _id: apiKey._id },
    {
      $set: { lastUsedAt: new Date(), lastUsedIp: ip },
      $inc: { totalRequests: 1 },
    },
  ).catch(() => {}); // non-blocking, ignore errors

  // ── 8. Return resolved context ───────────────────────────
  return {
    ok: true,
    companyId: apiKey.companyId.toString(),
    keyId: apiKey._id.toString(),
    connectorType: apiKey.connectorType,
    scopes: apiKey.scopes,
    environment: apiKey.environment,
    keyName: apiKey.name,
    rateLimit: rl,
    key: apiKey,
  };
}

// ── Helper ───────────────────────────────────────────────
function fail(response) {
  return { ok: false, response };
}

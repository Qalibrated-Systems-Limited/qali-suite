import { errorResponse } from "./envelope.js";

// ============================================
// INTEGRATION ERROR CODES + FACTORY
// Centralised so error messages are consistent
// across all /api/v1/* routes.
// ============================================

export const ERROR_CODES = {
  // Auth
  AUTH_MISSING_KEY:       "AUTH_MISSING_KEY",
  AUTH_INVALID_KEY:       "AUTH_INVALID_KEY",
  AUTH_KEY_REVOKED:       "AUTH_KEY_REVOKED",
  AUTH_KEY_EXPIRED:       "AUTH_KEY_EXPIRED",
  AUTH_INVALID_SIGNATURE: "AUTH_INVALID_SIGNATURE",
  AUTH_EXPIRED_TIMESTAMP: "AUTH_EXPIRED_TIMESTAMP",

  // Authorization
  FORBIDDEN_SCOPE:        "FORBIDDEN_SCOPE",
  FORBIDDEN_PLAN:         "FORBIDDEN_PLAN",
  TENANT_MISMATCH:        "TENANT_MISMATCH",

  // Validation
  VALIDATION_ERROR:       "VALIDATION_ERROR",
  BUSINESS_RULE:          "BUSINESS_RULE",

  // Resource
  NOT_FOUND:              "NOT_FOUND",
  DUPLICATE_REQUEST:      "DUPLICATE_REQUEST",

  // Rate limiting
  RATE_LIMITED:           "RATE_LIMITED",

  // Server
  INTERNAL_ERROR:         "INTERNAL_ERROR",
};

// ── Pre-built error responses ──────────────────

export const Errors = {
  missingKey: () =>
    errorResponse(ERROR_CODES.AUTH_MISSING_KEY,
      "Authorization header is required. Use: Bearer <api_key>", 401),

  invalidKey: () =>
    errorResponse(ERROR_CODES.AUTH_INVALID_KEY,
      "API key is invalid or does not exist.", 401),

  revokedKey: () =>
    errorResponse(ERROR_CODES.AUTH_KEY_REVOKED,
      "This API key has been revoked. Generate a new key in the integrations dashboard.", 401),

  expiredKey: () =>
    errorResponse(ERROR_CODES.AUTH_KEY_EXPIRED,
      "This API key has expired. Generate a new key in the integrations dashboard.", 401),

  invalidSignature: () =>
    errorResponse(ERROR_CODES.AUTH_INVALID_SIGNATURE,
      "HMAC signature verification failed. Check your signing secret.", 401),

  expiredTimestamp: () =>
    errorResponse(ERROR_CODES.AUTH_EXPIRED_TIMESTAMP,
      "Request timestamp is too old (>300s). Ensure your system clock is accurate.", 401),

  forbiddenScope: (required) =>
    errorResponse(ERROR_CODES.FORBIDDEN_SCOPE,
      `This API key does not have the required scope: ${required}.`, 403),

  forbiddenPlan: (requiredModule) =>
    errorResponse(ERROR_CODES.FORBIDDEN_PLAN,
      `Your current plan does not include integration access (requires: ${requiredModule}). Upgrade to Enterprise.`, 403),

  tenantMismatch: () =>
    errorResponse(ERROR_CODES.TENANT_MISMATCH,
      "Cross-tenant access is not permitted.", 403),

  validationError: (message, field = null) =>
    errorResponse(ERROR_CODES.VALIDATION_ERROR,
      message, 422, field ? { field } : {}),

  businessRule: (message) =>
    errorResponse(ERROR_CODES.BUSINESS_RULE,
      message, 422),

  notFound: (resource = "Resource") =>
    errorResponse(ERROR_CODES.NOT_FOUND,
      `${resource} not found.`, 404),

  duplicate: (externalRef) =>
    errorResponse(ERROR_CODES.DUPLICATE_REQUEST,
      `This request has already been processed (externalRef: ${externalRef}).`, 409),

  rateLimited: (retryAfter = 60) =>
    errorResponse(ERROR_CODES.RATE_LIMITED,
      "Too many requests. Slow down and retry after the indicated interval.", 429,
      { retryAfter }),

  internal: (detail = null) =>
    errorResponse(ERROR_CODES.INTERNAL_ERROR,
      detail || "An unexpected error occurred. Our team has been notified.", 500),
};

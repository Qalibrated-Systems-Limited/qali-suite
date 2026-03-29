import crypto from "crypto";

// ============================================
// API KEY GENERATION & HASHING UTILITIES
// Keys follow: qls_{env}_k_{32 hex chars}
// Stored as SHA-256 hash. Plaintext shown once.
// ============================================

const PREFIX = "qls";

/**
 * Generate a new API key pair.
 * Returns the plaintext key (show once) + metadata for storage.
 */
export function generateApiKey(environment = "live") {
  const raw = crypto.randomBytes(24).toString("hex"); // 48 hex chars → trim to 32
  const key = `${PREFIX}_${environment}_k_${raw.slice(0, 32)}`;

  return {
    plaintext: key,
    hash: hashKey(key),
    preview: key.slice(-4),           // last 4 chars for display
    prefix: `${PREFIX}_${environment}_k_`, // shown in UI
    environment,
  };
}

/**
 * Hash a key for storage / lookup.
 * SHA-256 — fast and sufficient for API key lookup.
 */
export function hashKey(plaintextKey) {
  return crypto
    .createHash("sha256")
    .update(plaintextKey)
    .digest("hex");
}

/**
 * Extract the Bearer token from an Authorization header.
 * Returns null if header is missing or malformed.
 */
export function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader) return null;
  const parts = authorizationHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  return parts[1] || null;
}

/**
 * Validate HMAC-SHA256 signature on a request.
 * message = METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + SHA256(body)
 */
export function verifyHmacSignature({ method, path, timestamp, body, signature, secret }) {
  const bodyHash = crypto.createHash("sha256").update(body || "").digest("hex");
  const message = `${method}\n${path}\n${timestamp}\n${bodyHash}`;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(message).digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/**
 * Check if a request timestamp is within the allowed window.
 * Prevents replay attacks. Window: ±300 seconds.
 */
export function isTimestampFresh(timestamp, windowSeconds = 300) {
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  const diff = Math.abs(Date.now() / 1000 - ts);
  return diff <= windowSeconds;
}

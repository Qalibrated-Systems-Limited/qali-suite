import "server-only";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

// ============================================
// LICENSE JWT SIGNER — ported from LicenseService.cs (IssueAsync/ValidateAsync).
//
// A license key IS an ES256-signed JWT. This module owns the key material and
// the sign/verify. The .NET service loads an EC P-256 JWK from configuration;
// here the key comes from the environment:
//
//   LICENSE_JWT_PRIVATE_KEY  — EC P-256 private key, PEM (PKCS#8). Required in
//                              production to issue keys clients can verify
//                              offline against a stable public key.
//   LICENSE_JWT_PUBLIC_KEY   — matching public key, PEM (SPKI). Optional; when
//                              absent it is derived from the private key.
//   LICENSE_JWT_ISSUER       — `iss` claim. Defaults to "qalibrated.co.ke",
//                              matching the .NET issuer.
//
// When no key is configured (local dev, preview, CI) an EPHEMERAL P-256 pair is
// generated once per process and cached. It lets the module be exercised
// end-to-end without secrets, but the public key changes on restart, so tokens
// signed under it cannot be verified by a client after a redeploy. A loud
// warning says so. NEVER rely on the ephemeral key in production.
// ============================================

const ISSUER = process.env.LICENSE_JWT_ISSUER || "qalibrated.co.ke";

// Cache the resolved keys on globalThis so Next's dev hot-reload and the
// serverless "reuse a warm lambda" model don't regenerate an ephemeral pair on
// every request (which would invalidate everything signed a moment earlier).
const globalForKeys = globalThis;

function normalisePem(value) {
  if (!value) return null;
  // Allow the key to be supplied with literal "\n" (common in .env / secrets
  // managers that don't preserve newlines).
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function loadKeys() {
  if (globalForKeys.__licenseKeys) return globalForKeys.__licenseKeys;

  const privPem = normalisePem(process.env.LICENSE_JWT_PRIVATE_KEY);

  if (privPem) {
    const privateKey = crypto.createPrivateKey(privPem);
    if (privateKey.asymmetricKeyType !== "ec") {
      throw new Error(
        "LICENSE_JWT_PRIVATE_KEY must be an EC (P-256) key for ES256 signing.",
      );
    }
    const pubPem = normalisePem(process.env.LICENSE_JWT_PUBLIC_KEY);
    const publicKey = pubPem
      ? crypto.createPublicKey(pubPem)
      : crypto.createPublicKey(privateKey);
    globalForKeys.__licenseKeys = { privateKey, publicKey, ephemeral: false };
    return globalForKeys.__licenseKeys;
  }

  // No configured key — ephemeral dev fallback.
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[licensing] LICENSE_JWT_PRIVATE_KEY is not set in production — issuing " +
        "keys with an EPHEMERAL signing key. Clients cannot verify these after " +
        "a redeploy. Configure LICENSE_JWT_PRIVATE_KEY.",
    );
  } else {
    console.warn(
      "[licensing] No LICENSE_JWT_PRIVATE_KEY set — using an ephemeral dev " +
        "signing key (regenerated on restart).",
    );
  }
  globalForKeys.__licenseKeys = { privateKey, publicKey, ephemeral: true };
  return globalForKeys.__licenseKeys;
}

/** True when a stable, configured signing key is in use (not the dev fallback). */
export function isSigningKeyConfigured() {
  return !loadKeys().ephemeral;
}

/** The public key as SPKI PEM — hand this to client apps for offline verify. */
export function getPublicKeyPem() {
  return loadKeys()
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();
}

/**
 * Sign a license JWT. Mirrors LicenseService.IssueAsync's claim set:
 *   sub=customerId, iss, iat, app, features[] (+ optional mid), nbf, exp.
 *
 * @param {object}  input
 * @param {string}  input.customerId
 * @param {string}  input.appId
 * @param {string[]} input.features
 * @param {Date}    input.expiresAt
 * @param {string=} input.machineId
 * @returns {string} the signed compact JWT
 */
export function signLicenseToken({ customerId, appId, features, expiresAt, machineId }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.floor(new Date(expiresAt).getTime() / 1000);

  const payload = {
    sub: customerId,
    iss: ISSUER,
    iat: now,
    nbf: now,
    exp,
    app: appId,
    features: Array.isArray(features) ? features : [],
  };
  if (machineId) payload.mid = machineId;

  const { privateKey } = loadKeys();
  // exp/nbf/iat are already in the payload, so no expiresIn/notBefore options
  // (jsonwebtoken forbids setting both).
  return jwt.sign(payload, privateKey, { algorithm: "ES256" });
}

/**
 * Verify a license JWT's signature and claims. Returns the decoded payload, or
 * throws. Server-side validation (ValidateAsync) does not depend on this — it
 * checks the DB record — but clients verify offline with the public key, and
 * this lets the server confirm a token it is about to store is well-formed.
 */
export function verifyLicenseToken(token) {
  const { publicKey } = loadKeys();
  return jwt.verify(token, publicKey, {
    algorithms: ["ES256"],
    issuer: ISSUER,
  });
}

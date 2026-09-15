import { getPublicKeyPem } from "@/lib/licensing/jwt";

// ============================================
// GET /api/licensing/public-key — the ES256 public key (SPKI PEM).
//
// Client apps fetch this once to verify license JWTs OFFLINE, so a kiosk on a
// flaky link can trust a cached key between server check-ins. Publishing a
// public key is safe by construction — it verifies signatures, it cannot make
// them. Unauthenticated, like the validate endpoint.
// ============================================

export async function GET() {
  try {
    const pem = getPublicKeyPem();
    return new Response(pem, {
      status: 200,
      headers: {
        "Content-Type": "application/x-pem-file",
        // The key is stable in production (configured) — let clients cache it.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return Response.json({ error: "public_key_unavailable" }, { status: 500 });
  }
}

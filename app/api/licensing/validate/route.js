import { validateLicense } from "@/app/db/actions/licensing-actions";

// ============================================
// POST /api/licensing/validate — client-app license check-in.
//
// The public counterpart to the .NET LicensesController.Validate endpoint.
// Client apps (QaliTrack frontend/mobile/kiosk) call this on activation and on
// daily check-in, presenting only their key — no session, no tenant. The key
// is a bearer secret that names its own record, so this is UNAUTHENTICATED by
// design, exactly as the Lante endpoint is.
//
// Body: { token, appId, machineId? }
// Returns the validation verdict: { valid: true, customerId, appId, features,
// expiresAt } or { valid: false, reason }. Same reason vocabulary as the .NET
// service (unknown_key, revoked, wrong_app, expired, machine_mismatch), plus
// bad_signature for a token that fails the offline signature check.
// ============================================

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { valid: false, reason: "bad_request", serverChecked: false },
      { status: 400 },
    );
  }

  const token = typeof body?.token === "string" ? body.token : "";
  const appId = typeof body?.appId === "string" ? body.appId : "";
  const machineId = typeof body?.machineId === "string" ? body.machineId : undefined;

  if (!token || !appId) {
    return Response.json(
      { valid: false, reason: "missing_token_or_app", serverChecked: false },
      { status: 400 },
    );
  }

  const result = await validateLicense({ token, appId, machineId });
  // Always 200: a failed validation is a valid, expected answer, not an HTTP
  // error — the client keys off `valid`, matching the .NET service.
  return Response.json(result, { status: 200 });
}

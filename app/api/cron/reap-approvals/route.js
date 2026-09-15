import { reapStaleApprovalLeases } from "@/app/db/actions/approval-actions";

// ============================================
// GET /api/cron/reap-approvals
//
// Reset stranded approval leases. approveApproval() atomically flips a
// request "submitted" → "applying" before applying its payload, then
// finalizes to "approved" (or rolls back to "submitted" on failure). If
// the process crashes or times out between the claim and that rollback,
// the request is stuck in "applying" forever — invisible to the queue
// (which only lists "submitted") and impossible to act on.
//
// This sweeper resets any "applying" doc older than STALE_MINUTES back to
// "submitted" so it re-enters the queue. A healthy apply takes seconds,
// so the window is wide enough never to interrupt one in flight.
//
// Security: requires CRON_SECRET env variable (same as other cron routes).
// Vercel cron.json example:
//   { "crons": [{ "path": "/api/cron/reap-approvals", "schedule": "*/5 * * * *" }] }
// ============================================

const STALE_MINUTES = 10;

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : null;

  if (!expected || authHeader !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // POSTGRES since 0101. The partial index on `updated_at WHERE status =
    // 'applying'` is what keeps this from scanning the table, exactly as the
    // Mongo partial index did.
    const reaped = await reapStaleApprovalLeases(STALE_MINUTES);
    if (reaped > 0) {
      console.warn(`[cron/reap-approvals] reset ${reaped} stranded lease(s)`);
    }
    return Response.json({ ok: true, reaped });
  } catch (err) {
    console.error("[cron/reap-approvals] error:", err);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

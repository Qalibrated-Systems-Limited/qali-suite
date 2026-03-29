import { processDueRetries } from "@/lib/integrations/webhooks/emitter";

// ============================================
// GET /api/cron/webhook-retry
//
// Process all webhook deliveries due for retry.
// Call on a 1-minute schedule from your cron service
// (Vercel Cron, GitHub Actions, external scheduler).
//
// Security: requires CRON_SECRET env variable.
// Set the same secret in your cron service's Authorization header.
//
// Vercel cron.json example:
//   { "crons": [{ "path": "/api/cron/webhook-retry", "schedule": "* * * * *" }] }
// And set CRON_SECRET in your project environment variables.
// ============================================

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : null;

  if (!expected || authHeader !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processDueRetries();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/webhook-retry] error:", err);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

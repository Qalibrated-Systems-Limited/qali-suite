import dbConnect from "@/app/config/dbConnect";
import {
  sendOverdueInvoiceDigests,
  sendLowStockDigests,
} from "@/lib/notifications/alert-digests";

// ============================================
// GET /api/cron/notify-alerts
//
// Daily alert digests, one email per tenant per topic:
//   - overdue invoices → finance roles
//   - low stock        → inventory roles
//
// Schedule once per day (e.g. 06:00 EAT) — these are digests, not pages;
// running more often just re-sends the same summary.
//
// Security: requires CRON_SECRET env variable (same as other cron routes).
// Vercel cron.json example:
//   { "crons": [{ "path": "/api/cron/notify-alerts", "schedule": "0 3 * * *" }] }
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
    await dbConnect();
    const [overdue, lowStock] = await Promise.all([
      sendOverdueInvoiceDigests(),
      sendLowStockDigests(),
    ]);
    return Response.json({ ok: true, overdue, lowStock });
  } catch (err) {
    console.error("[cron/notify-alerts] error:", err);
    return Response.json(
      { ok: false, error: "Alert digest run failed" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/safe-error";
import { withTenant } from "@/app/db/client";
import { listAllCompanies } from "@/app/db/platform";
import * as notifications from "@/app/db/repositories/notifications";

/**
 * The 90-day notification sweep, for every tenant.
 *
 * WHY THIS ROUTE EXISTS. The Mongo `Notification` collection self-cleaned: a
 * TTL index expired documents 90 days after creation, and its schema said so —
 * "Self-cleaning: … so the collection never needs a manual sweep."
 *
 * Postgres has no TTL index. Porting the table without this would have dropped
 * that property silently, and the first anyone would know is a notifications
 * table years deep with an unread count query crawling through it. So the sweep
 * is explicit, on a schedule, and `notifications_created_idx` exists for it.
 *
 * Per-tenant rather than one platform-wide DELETE, because RLS scopes every
 * statement to `app.company_id` — the same shape as /api/cron/mark-absent, and
 * for the same reason.
 *
 * Protected by CRON_SECRET, as the other cron routes are. Daily is plenty:
 * nothing depends on a row disappearing on a particular day.
 *   { "crons": [{ "path": "/api/cron/prune-notifications", "schedule": "0 4 * * *" }] }
 */

/** Matches the TTL the Mongo index carried. */
const RETENTION_DAYS = 90;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const companies = await listAllCompanies();
    const results = [];
    let total = 0;

    for (const company of companies) {
      try {
        const deleted = await withTenant(company.id, (tx) =>
          notifications.deleteOlderThan(tx, RETENTION_DAYS),
        );
        total += deleted;
        // Only report tenants that actually had something to remove; a list of
        // sixty zeroes is not a log, it is noise.
        if (deleted > 0) results.push({ company: company.name, deleted });
      } catch (err) {
        // One tenant's failure must not stop the rest.
        console.error(`[cron/prune-notifications] ${company.name} failed:`, err);
        results.push({ company: company.name, error: safeErrorMessage(err) });
      }
    }

    return NextResponse.json({ ok: true, retentionDays: RETENTION_DAYS, total, results });
  } catch (err) {
    console.error("[cron/prune-notifications] error:", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

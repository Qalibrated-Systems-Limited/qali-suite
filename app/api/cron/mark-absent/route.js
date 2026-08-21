import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/safe-error";
import { withTenant } from "@/app/db/client";
import { listAllCompanies } from "@/app/db/platform";
import * as attendance from "@/app/db/repositories/attendance";
import { getTimezone, getLocalYMD } from "@/lib/hr/time";

/**
 * Nightly attendance close-out, for every tenant.
 *
 * Two things, in order:
 *
 *   1. CLOSE what was left open. Somebody who clocked in and never clocked out
 *      is closed at their own shift end — the source caps them at
 *      `checkIn + standardHours`, which records exactly a full day for
 *      somebody who left after an hour.
 *
 *   2. MARK the day. Everybody with no record becomes absent, EXCEPT on a
 *      weekend or a public holiday — the source marks Saturdays absent — and
 *      except somebody on approved leave, who is marked as on leave rather
 *      than as having failed to turn up.
 *
 * The date is each tenant's local one. A single UTC day key marks the wrong
 * day for anybody far enough east or west.
 *
 * Protected by CRON_SECRET, as before.
 */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const companies = await listAllCompanies();
    const results = [];

    for (const company of companies) {
      try {
        const result = await withTenant(company.id, async (tx) => {
          const policy = await attendance.getPolicy(tx, company.id);
          const workDate = getLocalYMD(new Date(), getTimezone(policy));

          const closed = await attendance.closeStaleAttendance(tx, company.id);
          const marked = await attendance.markAbsentees(tx, {
            companyId: company.id,
            workDate,
          });

          return { workDate, closed: closed.closed, ...marked };
        });

        results.push({ company: company.name, ...result });
      } catch (err) {
        // One tenant's failure must not stop the rest.
        console.error(`[cron/mark-absent] ${company.name} failed:`, err);
        results.push({ company: company.name, error: safeErrorMessage(err) });
      }
    }

    const totals = results.reduce(
      (acc, r) => ({
        absent: acc.absent + (r.absent ?? 0),
        onLeave: acc.onLeave + (r.onLeave ?? 0),
        closed: acc.closed + (r.closed ?? 0),
        failed: acc.failed + (r.error ? 1 : 0),
      }),
      { absent: 0, onLeave: 0, closed: 0, failed: 0 },
    );

    console.log(
      `[cron/mark-absent] ${new Date().toISOString()} — ${totals.absent} absent, ` +
        `${totals.onLeave} on leave, ${totals.closed} auto-closed across ` +
        `${companies.length} companies (${totals.failed} failed)`,
    );

    return NextResponse.json({ ok: true, totals, results });
  } catch (error) {
    console.error("[cron/mark-absent] error:", error);
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/safe-error";
import { privilegedDb } from "@/app/db/provisioning";
import { openArrivedPeriods } from "@/app/db/repositories/fiscalPeriods";

/**
 * A fiscal period opens when it begins — nightly, for every tenant.
 *
 * ── WHY THIS JOB EXISTS ────────────────────────────────────────────────────
 *
 * Provisioning seeds twelve periods and opens only the first; the other eleven
 * are `future`. Until 0106, NOTHING moved one out of `future` — no cron, no
 * open-on-arrival, no open-the-next-when-you-close-this-one. Migration 0030
 * wrote that gap down and left the policy as a product decision; 0106 made it,
 * and this is the ongoing half of it.
 *
 * The cost of not having it was concrete: `closePeriod` requires `open`, so a
 * company onboarded in January could not close ANY month but January, for ever.
 *
 * ── WHY PRIVILEGED AND NOT PER-TENANT ──────────────────────────────────────
 *
 * This is one UPDATE with a predicate no tenant's data can influence — a date
 * comparison against a status. `mark-absent` loops tenants because each one's
 * answer depends on its own timezone, policy and roster; there is nothing here
 * to ask a tenant about. An estate of four hundred companies is one statement
 * rather than four hundred transactions, which also removes the failure mode
 * that loop carries: a tenant that errors halfway leaves the rest undone.
 *
 * `alerts.ts` is the standing precedent for a cron reading across tenants on
 * the privileged connection, and for the same reason: no session, and a job
 * that reports per tenant cannot run on a connection scoped to one.
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
 *
 * Only `future` -> `open`, only when the start date has arrived. A closed or
 * locked period is not matched, so this can never quietly undo a month-end,
 * and a period somebody opened early is already `open` and is not matched
 * either. Running it twice in a night changes nothing the first run did not.
 *
 * Protected by CRON_SECRET, like every other route in this family.
 */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ONE DEFINITION OF THE PREDICATE, shared with the tenant-scoped caller.
    // `openArrivedPeriods` takes an executor rather than a `Tx` precisely so
    // this route can hand it the privileged connection and still run the
    // statement the repository owns, instead of keeping a second copy here
    // that could drift from it.
    const result = await openArrivedPeriods(privilegedDb());

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/open-fiscal-periods] failed:", err);
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(err) },
      { status: 500 },
    );
  }
}

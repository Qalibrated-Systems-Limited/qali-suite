"use server";

import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import * as periods from "../repositories/fiscalPeriods";

/**
 * Fiscal periods, on Postgres.
 *
 * The Mongo module carried its own auth check, its own role list and its own
 * tenant filter in every one of fifteen functions. All three are
 * `withAuthorizedTenant`'s job here, so what is left is the part that differs
 * between them: which roles may do which thing.
 *
 * Shapes match `app/mongodb/actions/fiscal-period-actions.js`, which returns
 * `{ success, ... }` rather than throwing, because the screens render the
 * error inline.
 */

/** Who may create, edit and close. Mirrors the Mongo list. */
const MANAGE_ROLES = ["Admin", "CFO", "Finance Manager", "Accountant"];

/**
 * Reopening is deliberately narrower — no Accountant.
 *
 * Closing a period is routine month-end work. Reopening one moves the line
 * between what is settled and what is still being written, after somebody has
 * already signed it off, so it sits with the people who answer for the
 * accounts. Locking is narrower still, and permanent.
 */
const REOPEN_ROLES = ["Admin", "CFO", "Finance Manager"];
const LOCK_ROLES = ["Admin", "CFO"];

type Result<T = unknown> = { success: boolean; error?: string } & T;

const fail = (e: unknown, fallback: string) => ({
  success: false as const,
  error: e instanceof Error ? e.message : fallback,
});

function refresh(periodId?: string) {
  revalidatePath("/dashboard/settings/fiscal-periods");
  if (periodId) revalidatePath(`/dashboard/settings/fiscal-periods/${periodId}`);
  // A period's status decides what the journal will accept, so the journal
  // screens are stale the moment one changes.
  revalidatePath("/dashboard/journal");
}

export async function fetchFiscalPeriods(
  filters: { year?: number; status?: string } = {},
): Promise<Result<{ periods?: periods.FiscalPeriodRow[] }>> {
  try {
    const rows = await withAuthorizedTenant([], (tx) =>
      periods.listPeriods(tx, filters),
    );
    return { success: true, periods: rows };
  } catch (e) {
    return fail(e, "Could not load the fiscal periods.");
  }
}

export async function fetchFiscalPeriodById(periodId: string) {
  try {
    const period = await withAuthorizedTenant([], (tx) =>
      periods.getPeriod(tx, periodId),
    );
    if (!period) return { success: false, error: "Fiscal period not found" };
    return { success: true, period };
  } catch (e) {
    return fail(e, "Could not load that fiscal period.");
  }
}

export async function fetchCurrentPeriod() {
  try {
    const period = await withAuthorizedTenant([], (tx) =>
      periods.getCurrentPeriod(tx),
    );
    return { success: true, period };
  } catch (e) {
    return fail(e, "Could not determine the current period.");
  }
}

export async function fetchOpenPeriods() {
  return fetchFiscalPeriods({ status: "open" });
}

export async function fetchPeriodsByYear(year: number) {
  return fetchFiscalPeriods({ year });
}

export async function fetchFiscalPeriodStats() {
  try {
    const stats = await withAuthorizedTenant([], (tx) =>
      periods.getPeriodStats(tx),
    );
    return { success: true, stats };
  } catch (e) {
    return fail(e, "Could not load the fiscal period statistics.");
  }
}

export async function fetchPeriodSummary(periodId: string) {
  try {
    const summary = await withAuthorizedTenant([], (tx) =>
      periods.getPeriodSummary(tx, periodId),
    );
    return { success: true, summary };
  } catch (e) {
    return fail(e, "Could not summarise that period.");
  }
}

export async function fetchClosingChecklist(periodId: string) {
  try {
    const checklist = await withAuthorizedTenant([], (tx) =>
      periods.getClosingChecklist(tx, periodId),
    );
    return { success: true, checklist };
  } catch (e) {
    return fail(e, "Could not build the closing checklist.");
  }
}

export async function createFiscalPeriod(data: {
  startDate: string;
  endDate: string;
  periodType?: "month" | "quarter";
}) {
  try {
    const period = await withAuthorizedTenant(MANAGE_ROLES, (tx, { companyId }) =>
      periods.createPeriod(tx, { ...data, companyId }),
    );
    refresh();
    return { success: true, period };
  } catch (e) {
    return fail(e, "Could not create the fiscal period.");
  }
}

export async function createYearPeriods(
  year: number,
  periodType: "month" | "quarter" = "month",
) {
  try {
    const created = await withAuthorizedTenant(
      MANAGE_ROLES,
      (tx, { companyId }) =>
        periods.createYearPeriods(tx, companyId, year, periodType),
    );
    refresh();
    return {
      success: true,
      created: created.length,
      // Running it twice adds only what was missing, so saying how many were
      // created is more use than "done".
      message:
        created.length === 0
          ? `${year} already has its periods.`
          : `Created ${created.length} period${created.length === 1 ? "" : "s"} for ${year}.`,
    };
  } catch (e) {
    return fail(e, `Could not create the periods for ${year}.`);
  }
}

export async function updateFiscalPeriod(
  periodId: string,
  data: { periodName?: string; startDate?: string; endDate?: string },
) {
  try {
    const period = await withAuthorizedTenant(MANAGE_ROLES, (tx) =>
      periods.updatePeriod(tx, periodId, data),
    );
    refresh(periodId);
    return { success: true, period };
  } catch (e) {
    return fail(e, "Could not update the fiscal period.");
  }
}

/**
 * Kept for the "Recalculate statistics" button, and it no longer calculates.
 *
 * The Mongo period document stored `statistics` and `closingBalances`, written
 * at close time, so they could drift from the ledger they summarised and
 * needed a button to refresh them. Postgres derives them on read — the figures
 * are current by construction — so this returns the summary rather than
 * writing anything.
 *
 * The button is left in place because it still does something useful: it
 * re-reads and shows the period as it stands. When the screen is next revised,
 * it should be relabelled or dropped.
 */
export async function calculatePeriodStatistics(periodId: string) {
  return fetchPeriodSummary(periodId);
}

export async function closeFiscalPeriod(periodId: string) {
  try {
    const result = await withAuthorizedTenant(MANAGE_ROLES, (tx, { user }) =>
      periods.closePeriod(tx, periodId, { id: user.id, name: user.name }),
    );
    refresh(periodId);
    return { success: true, ...result };
  } catch (e) {
    return fail(e, "Could not close the fiscal period.");
  }
}

export async function reopenFiscalPeriod(periodId: string, reason?: string) {
  try {
    const period = await withAuthorizedTenant(REOPEN_ROLES, (tx, { user }) =>
      periods.reopenPeriod(tx, periodId, { id: user.id }),
    );
    refresh(periodId);
    void reason;
    return { success: true, period };
  } catch (e) {
    return fail(e, "Could not reopen the fiscal period.");
  }
}

export async function lockFiscalPeriod(periodId: string, reason?: string) {
  try {
    const period = await withAuthorizedTenant(LOCK_ROLES, (tx, { user }) =>
      periods.lockPeriod(tx, periodId, { id: user.id }),
    );
    refresh(periodId);
    void reason;
    return { success: true, period };
  } catch (e) {
    return fail(e, "Could not lock the fiscal period.");
  }
}

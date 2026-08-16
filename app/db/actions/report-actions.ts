"use server";

import { withAuthorizedTenant, FINANCE_ROLES } from "../tenant";
import * as reportQueries from "../repositories/reportQueries";
import type {
  TrialBalanceReport,
  GeneralLedgerReport,
} from "../repositories/reportQueries";

/**
 * Postgres-backed report actions.
 *
 * Thin by design: authorise, open an RLS-scoped transaction, delegate. All SQL
 * lives in app/db/repositories/reportQueries.ts — see the layering rule in
 * docs/POSTGRES-MIGRATION-PLAN.md §4.1.
 */

export async function getTrialBalanceDataPg(
  asOfDate: string,
  showZeroBalances = false,
): Promise<TrialBalanceReport> {
  return withAuthorizedTenant(FINANCE_ROLES, (tx) =>
    reportQueries.getTrialBalanceReport(tx, asOfDate, showZeroBalances),
  );
}

export async function getGeneralLedgerDataPg(
  accountId: string,
  startDate?: string,
  endDate?: string,
): Promise<GeneralLedgerReport> {
  return withAuthorizedTenant(FINANCE_ROLES, (tx) =>
    reportQueries.getGeneralLedger(tx, accountId, startDate, endDate),
  );
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * P&L, optionally against a comparison period.
 *
 * The wrapper shape — { current } or { current, comparison, variance } — and
 * the comparison date arithmetic mirror getProfitLossData() in
 * app/mongodb/queries/reportQueries.js, so the client component is unchanged.
 * Both periods are read inside ONE transaction, so a posting landing mid-report
 * cannot make the two halves disagree.
 */
export async function getProfitLossDataPg(
  startDate: string,
  endDate: string,
  comparison: "previous_period" | "previous_year" | null = null,
) {
  return withAuthorizedTenant(FINANCE_ROLES, async (tx) => {
    const current = await reportQueries.getProfitLoss(tx, startDate, endDate);
    if (!comparison) return { current };

    let cmpStart: Date;
    let cmpEnd: Date;

    if (comparison === "previous_period") {
      const length = new Date(endDate).getTime() - new Date(startDate).getTime();
      cmpEnd = new Date(new Date(startDate).getTime() - 1);
      cmpStart = new Date(cmpEnd.getTime() - length);
    } else {
      cmpStart = new Date(startDate);
      cmpStart.setFullYear(cmpStart.getFullYear() - 1);
      cmpEnd = new Date(endDate);
      cmpEnd.setFullYear(cmpEnd.getFullYear() - 1);
    }

    const prior = await reportQueries.getProfitLoss(tx, day(cmpStart), day(cmpEnd));

    return {
      current,
      comparison: prior,
      variance: {
        revenue: current.summary.grossProfit - prior.summary.grossProfit,
        expenses: current.summary.totalExpenses - prior.summary.totalExpenses,
        netIncome: current.summary.netIncome - prior.summary.netIncome,
      },
    };
  });
}

export async function getBalanceSheetDataPg(asOfDate: string) {
  return withAuthorizedTenant(FINANCE_ROLES, (tx) =>
    reportQueries.getBalanceSheet(tx, asOfDate),
  );
}

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

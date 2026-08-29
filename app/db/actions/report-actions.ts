"use server";

import { withAuthorizedTenant, FINANCE_ROLES } from "../tenant";
import * as reportQueries from "../repositories/reportQueries";
import * as reportsRepo from "../repositories/reports";
import { coerceDayString } from "@/lib/utils/report-dates";
import { EXECUTIVE_VIEW_ROLES } from "@/lib/utils/role-gates";
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

/**
 * Every date crossing into a repository is normalised to a day string here.
 *
 * These are the boundary: pages, search params and client components all reach
 * them, and a `Date` handed to a `::date` parameter does not fail as a bad
 * date — it fails inside postgres.js as "the string argument must be of type
 * string", wrapped in a DrizzleQueryError that prints the whole statement.
 * See lib/utils/report-dates.js.
 */
function requireDay(value: unknown, field: string): string {
  const day = coerceDayString(value);
  if (!day) throw new Error(`${field} is not a valid date.`);
  return day;
}

/**
 * What the reader is told when a report fails.
 *
 * drizzle wraps a driver failure in a DrizzleQueryError whose `message` is the
 * entire statement plus its parameters, and the report pages render
 * `err.message` on the error card. So "Error Loading Report" was followed by
 * two hundred characters of SQL — which tells the accountant nothing, and
 * publishes the schema to anyone who can open the page.
 *
 * The cause carries the real reason; that is what is shown, and the full error
 * still goes to the server log.
 */
async function report<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const cause = (err as { cause?: unknown })?.cause;
    const detail =
      (cause as { message?: string } | undefined)?.message ??
      (err as Error).message;
    console.error(`[report:${label}]`, err);
    throw new Error(`${label} could not be produced: ${detail}`);
  }
}

export async function getTrialBalanceDataPg(
  asOfDate: string,
  showZeroBalances = false,
): Promise<TrialBalanceReport> {
  const asOf = requireDay(asOfDate, "As-of date");
  return report("Trial Balance", () =>
    withAuthorizedTenant(FINANCE_ROLES, (tx) =>
      reportQueries.getTrialBalanceReport(tx, asOf, showZeroBalances),
    ),
  );
}

export async function getGeneralLedgerDataPg(
  accountId: string,
  startDate?: string,
  endDate?: string,
): Promise<GeneralLedgerReport> {
  const from = startDate ? requireDay(startDate, "Start date") : undefined;
  const to = endDate ? requireDay(endDate, "End date") : undefined;
  return report("General Ledger", () =>
    withAuthorizedTenant(FINANCE_ROLES, (tx) =>
      reportQueries.getGeneralLedger(tx, accountId, from, to),
    ),
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
  const from = requireDay(startDate, "Start date");
  const to = requireDay(endDate, "End date");

  return report("Profit & Loss", () =>
    withAuthorizedTenant(FINANCE_ROLES, async (tx) => {
      const current = await reportQueries.getProfitLoss(tx, from, to);
      if (!comparison) return { current };

      let cmpStart: Date;
      let cmpEnd: Date;

      // Arithmetic on the NORMALISED days, in UTC. `new Date("2026-08-01")` is
      // UTC midnight, so day() below reads back the same calendar date it was
      // given — which is only true because `from`/`to` are day strings.
      if (comparison === "previous_period") {
        const length = new Date(to).getTime() - new Date(from).getTime();
        cmpEnd = new Date(new Date(from).getTime() - 86_400_000);
        cmpStart = new Date(cmpEnd.getTime() - length);
      } else {
        cmpStart = new Date(from);
        cmpStart.setUTCFullYear(cmpStart.getUTCFullYear() - 1);
        cmpEnd = new Date(to);
        cmpEnd.setUTCFullYear(cmpEnd.getUTCFullYear() - 1);
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
    }),
  );
}

export async function getBalanceSheetDataPg(asOfDate: string) {
  const asOf = requireDay(asOfDate, "As-of date");
  return report("Balance Sheet", () =>
    withAuthorizedTenant(FINANCE_ROLES, (tx) =>
      reportQueries.getBalanceSheet(tx, asOf),
    ),
  );
}

/**
 * The executive overview's seven numbers.
 *
 * Gated on EXECUTIVE_VIEW_ROLES rather than FINANCE_ROLES. `Viewer` is what
 * CEO became (0039) and this screen is that role's home — a finance gate would
 * lock out the one person it was built for, and `withAuthorizedTenant` throws
 * rather than degrading, so the page would have shown its "could not load"
 * message to the CEO and to nobody else.
 */
export async function getExecutiveSnapshotPg() {
  return report("Executive snapshot", () =>
    withAuthorizedTenant([...EXECUTIVE_VIEW_ROLES], (tx) =>
      reportQueries.getExecutiveSnapshot(tx),
    ),
  );
}

/**
 * AR and AP aging, in the shape the two report pages render.
 *
 * `aging-queries.js` aggregates the Mongo `Invoice` and `Bill` collections —
 * both of which moved — so those pages have shown a store nothing writes.
 * Worse than stale: the executive overview's "Owed to us" and "We owe" tiles
 * read the LEDGER, and they link straight here, so the tile and the page it
 * opened disagreed.
 *
 * They cannot now: this is `getAgingReport`, the same function behind the
 * tiles, reshaped. The buckets are renamed on the way out (`days0_30` →
 * `days1_30`) because that is what the clients read, and the summary is
 * totalled here rather than in each of the two pages.
 */
function toAgingReport(
  rows: Awaited<ReturnType<typeof reportsRepo.getAgingReport>>,
  asOfDate: string,
  side: "receivable" | "payable",
) {
  const n = (v: unknown) => Number(v ?? 0);
  const isAR = side === "receivable";

  const parties = rows.map((r) => {
    const count = n(r.itemCount);
    return {
      // Both id/name pairs and both counts, because the two clients read
      // different names for the same column and neither should have to care.
      customerId: r.partyId,
      supplierId: r.partyId,
      customerName: r.partyName ?? "Unnamed",
      supplierName: r.partyName ?? "Unnamed",
      current: n(r.current),
      days1_30: n(r.days0_30),
      days31_60: n(r.days31_60),
      days61_90: n(r.days61_90),
      days90plus: n(r.days90plus),
      total: n(r.total),
      invoiceCount: count,
      billCount: count,
    };
  });

  const summary = parties.reduce(
    (acc, p) => ({
      current: acc.current + p.current,
      days1_30: acc.days1_30 + p.days1_30,
      days31_60: acc.days31_60 + p.days31_60,
      days61_90: acc.days61_90 + p.days61_90,
      days90plus: acc.days90plus + p.days90plus,
      total: acc.total + p.total,
      customerCount: acc.customerCount + 1,
      supplierCount: acc.supplierCount + 1,
      invoiceCount: acc.invoiceCount + p.invoiceCount,
      billCount: acc.billCount + p.billCount,
    }),
    {
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      days90plus: 0,
      total: 0,
      customerCount: 0,
      supplierCount: 0,
      invoiceCount: 0,
      billCount: 0,
    },
  );

  const overdueTotal =
    summary.days1_30 + summary.days31_60 + summary.days61_90 + summary.days90plus;

  return {
    reportName: isAR ? "Accounts Receivable Aging" : "Accounts Payable Aging",
    asOfDate: new Date(asOfDate),
    customers: parties,
    suppliers: parties,
    summary: {
      ...summary,
      overdueTotal,
      // Against a zero total the share overdue is undefined, not 100%.
      overduePercent: summary.total > 0 ? (overdueTotal / summary.total) * 100 : 0,
    },
    source: "postgres" as const,
  };
}

export async function getARAgingReportPg(asOfDate?: string) {
  const asOf = requireDay(asOfDate ?? new Date(), "As-of date");
  return report("AR Aging", () =>
    withAuthorizedTenant(FINANCE_ROLES, async (tx) =>
      toAgingReport(
        await reportsRepo.getAgingReport(tx, "receivable", asOf),
        asOf,
        "receivable",
      ),
    ),
  );
}

export async function getAPAgingReportPg(asOfDate?: string) {
  const asOf = requireDay(asOfDate ?? new Date(), "As-of date");
  return report("AP Aging", () =>
    withAuthorizedTenant(FINANCE_ROLES, async (tx) =>
      toAgingReport(
        await reportsRepo.getAgingReport(tx, "payable", asOf),
        asOf,
        "payable",
      ),
    ),
  );
}

export async function getCashFlowDataPg(startDate: unknown, endDate: unknown) {
  const from = requireDay(startDate, "Start date");
  const to = requireDay(endDate, "End date");
  return report("Cash Flow", () =>
    withAuthorizedTenant(FINANCE_ROLES, (tx) =>
      reportQueries.getCashFlow(tx, from, to),
    ),
  );
}

export async function getSalesByCustomerReportPg(startDate: unknown, endDate: unknown) {
  const from = requireDay(startDate, "Start date");
  const to = requireDay(endDate, "End date");
  return report("Sales by Customer", () =>
    withAuthorizedTenant(FINANCE_ROLES, (tx) =>
      reportQueries.getSalesByCustomer(tx, from, to),
    ),
  );
}

export async function getSalesByProductReportPg(startDate: unknown, endDate: unknown) {
  const from = requireDay(startDate, "Start date");
  const to = requireDay(endDate, "End date");
  return report("Sales by Product", () =>
    withAuthorizedTenant(FINANCE_ROLES, (tx) =>
      reportQueries.getSalesByProduct(tx, from, to),
    ),
  );
}

export async function getSupplierPurchaseReportPg(startDate: unknown, endDate: unknown) {
  const from = requireDay(startDate, "Start date");
  const to = requireDay(endDate, "End date");
  return report("Purchase Report", () =>
    withAuthorizedTenant(FINANCE_ROLES, (tx) =>
      reportQueries.getSupplierPurchases(tx, from, to),
    ),
  );
}

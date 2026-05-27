import ReportService from "../services/reportsService";
import JournalEntry from "../../models/JournalEntry";
import dbConnect from "../../config/dbConnect";
import { getTenantContext, buildTenantMatch } from "@/lib/utils/tenant-utils";

// ============================================
// REPORT QUERIES - FINANCIAL REPORTS
// Following industry best practices
// ============================================

/**
 * Get Profit & Loss Statement data
 * Best Practice: With percentages, comparison periods, drill-down
 */
export async function getProfitLossData(startDate, endDate, comparison = null) {
  await dbConnect();

  const currentReport = await ReportService.generateProfitLoss(
    startDate,
    endDate
  );

  // Add comparison if requested
  if (comparison) {
    let comparisonStartDate, comparisonEndDate;

    if (comparison === "previous_period") {
      const periodLength =
        new Date(endDate).getTime() - new Date(startDate).getTime();
      comparisonEndDate = new Date(new Date(startDate).getTime() - 1);
      comparisonStartDate = new Date(
        comparisonEndDate.getTime() - periodLength
      );
    } else if (comparison === "previous_year") {
      comparisonStartDate = new Date(startDate);
      comparisonStartDate.setFullYear(comparisonStartDate.getFullYear() - 1);
      comparisonEndDate = new Date(endDate);
      comparisonEndDate.setFullYear(comparisonEndDate.getFullYear() - 1);
    }

    if (comparisonStartDate && comparisonEndDate) {
      const comparisonReport = await ReportService.generateProfitLoss(
        comparisonStartDate,
        comparisonEndDate
      );

      return {
        current: currentReport,
        comparison: comparisonReport,
        variance: {
          revenue:
            currentReport.summary.grossProfit -
            comparisonReport.summary.grossProfit,
          expenses:
            currentReport.summary.totalExpenses -
            comparisonReport.summary.totalExpenses,
          netIncome:
            currentReport.summary.netIncome -
            comparisonReport.summary.netIncome,
        },
      };
    }
  }

  return { current: currentReport };
}

/**
 * Get Balance Sheet data
 * Best Practice: Grouped by current/non-current, validates equation
 */
export async function getBalanceSheetData(asOfDate) {
  await dbConnect();
  return await ReportService.generateBalanceSheet(asOfDate);
}

/**
 * Get Trial Balance data
 * Best Practice: Show only non-zero balances, validates debits=credits
 */
export async function getTrialBalanceData(asOfDate, showZeroBalances = false) {
  await dbConnect();

  const trialBalance = await ReportService.generateTrialBalance(asOfDate);

  // Filter out zero balances if requested
  if (!showZeroBalances) {
    trialBalance.accounts = trialBalance.accounts.filter(
      (account) =>
        Math.abs(account.debit) > 0.01 || Math.abs(account.credit) > 0.01
    );
  }

  return trialBalance;
}

/**
 * Get Cash Flow Statement data
 * Best Practice: Categorized into Operating/Investing/Financing
 */
export async function getCashFlowData(startDate, endDate) {
  await dbConnect();
  return await ReportService.generateCashFlow(startDate, endDate);
}

/**
 * Get General Ledger for account
 * Best Practice: Paginated with running balance
 */
export async function getGeneralLedgerData(accountId, startDate, endDate) {
  await dbConnect();
  return await ReportService.generateGeneralLedger(
    accountId,
    startDate,
    endDate
  );
}

/**
 * Get Accounts Receivable Aging Report
 * Best Practice: Aged buckets (Current, 0-30, 31-60, 61-90, 90+)
 */
export async function getARAgingData(asOfDate = new Date()) {
  await dbConnect();

  // Use service method if available
  if (typeof JournalEntry.getARAgingReport === "function") {
    return await JournalEntry.getARAgingReport(asOfDate);
  }

  // Use report service fallback
  return await ReportService.generateAgedReceivables(asOfDate);
}

/**
 * Get Accounts Payable Aging Report
 * Best Practice: Aged buckets (Current, 0-30, 31-60, 61-90, 90+)
 */
export async function getAPAgingData(asOfDate = new Date()) {
  await dbConnect();

  // Use service method if available
  if (typeof JournalEntry.getAPAgingReport === "function") {
    return await JournalEntry.getAPAgingReport(asOfDate);
  }

  // Use report service fallback
  return await ReportService.generateAgedPayables(asOfDate);
}

/**
 * Get report summary for dashboard
 * Best Practice: Quick KPIs for dashboard
 */
export async function getReportSummary(startDate, endDate) {
  await dbConnect();

  const [profitLoss, balanceSheet] = await Promise.all([
    ReportService.generateProfitLoss(startDate, endDate),
    ReportService.generateBalanceSheet(endDate),
  ]);

  return {
    period: { startDate, endDate },
    summary: {
      revenue: profitLoss.revenue.total,
      expenses: profitLoss.expenses.total,
      netIncome: profitLoss.summary.netIncome,
      netMargin: profitLoss.summary.netMargin,
      totalAssets: balanceSheet.summary.totalAssets,
      totalLiabilities: balanceSheet.summary.totalLiabilities,
      totalEquity: balanceSheet.summary.totalEquity,
      currentRatio:
        balanceSheet.liabilities.current.length > 0
          ? balanceSheet.assets.current.reduce((sum, a) => sum + a.balance, 0) /
            balanceSheet.liabilities.current.reduce(
              (sum, l) => sum + l.balance,
              0
            )
          : 0,
    },
  };
}

/**
 * Get available date ranges for reports (for dropdown)
 */
export async function getAvailableDateRanges() {
  await dbConnect();

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  return {
    presets: [
      {
        label: "This Month",
        startDate: new Date(currentYear, currentMonth, 1),
        endDate: new Date(currentYear, currentMonth + 1, 0),
      },
      {
        label: "Last Month",
        startDate: new Date(currentYear, currentMonth - 1, 1),
        endDate: new Date(currentYear, currentMonth, 0),
      },
      {
        label: "This Quarter",
        startDate: new Date(currentYear, Math.floor(currentMonth / 3) * 3, 1),
        endDate: new Date(currentYear, Math.floor(currentMonth / 3) * 3 + 3, 0),
      },
      {
        label: "This Year",
        startDate: new Date(currentYear, 0, 1),
        endDate: new Date(currentYear, 11, 31),
      },
      {
        label: "Last Year",
        startDate: new Date(currentYear - 1, 0, 1),
        endDate: new Date(currentYear - 1, 11, 31),
      },
    ],
  };
}

/**
 * Get revenue by account (for drill-down)
 */
export async function getRevenueByAccount(startDate, endDate) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const result = await JournalEntry.aggregate([
    {
      $match: {
        ...tenantMatch,
        status: "posted",
        entryDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      },
    },
    { $unwind: "$lines" },
    {
      $lookup: {
        from: "accounts",
        localField: "lines.accountId",
        foreignField: "_id",
        as: "account",
      },
    },
    { $unwind: "$account" },
    { $match: { "account.accountType": "revenue" } },
    {
      $group: {
        _id: {
          accountId: "$account._id",
          accountCode: "$account.accountCode",
          accountName: "$account.accountName",
        },
        totalCredit: { $sum: "$lines.credit" },
        totalDebit: { $sum: "$lines.debit" },
        transactionCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        accountId: "$_id.accountId",
        accountCode: "$_id.accountCode",
        accountName: "$_id.accountName",
        revenue: { $subtract: ["$totalCredit", "$totalDebit"] },
        transactionCount: 1,
      },
    },
    { $sort: { revenue: -1 } },
  ]);

  const totalRevenue = result.reduce((sum, item) => sum + item.revenue, 0);

  return {
    accounts: result.map((item) => ({
      ...item,
      percentage: totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0,
    })),
    total: totalRevenue,
  };
}

/**
 * Get expenses by account (for drill-down)
 */
export async function getExpensesByAccount(startDate, endDate) {
  await dbConnect();

  // Get tenant context
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

  const result = await JournalEntry.aggregate([
    {
      $match: {
        ...tenantMatch,
        status: "posted",
        entryDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      },
    },
    { $unwind: "$lines" },
    {
      $lookup: {
        from: "accounts",
        localField: "lines.accountId",
        foreignField: "_id",
        as: "account",
      },
    },
    { $unwind: "$account" },
    { $match: { "account.accountType": "expense" } },
    {
      $group: {
        _id: {
          accountId: "$account._id",
          accountCode: "$account.accountCode",
          accountName: "$account.accountName",
        },
        totalDebit: { $sum: "$lines.debit" },
        totalCredit: { $sum: "$lines.credit" },
        transactionCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        accountId: "$_id.accountId",
        accountCode: "$_id.accountCode",
        accountName: "$_id.accountName",
        expense: { $subtract: ["$totalDebit", "$totalCredit"] },
        transactionCount: 1,
      },
    },
    { $sort: { expense: -1 } },
  ]);

  const totalExpense = result.reduce((sum, item) => sum + item.expense, 0);

  return {
    accounts: result.map((item) => ({
      ...item,
      percentage: totalExpense > 0 ? (item.expense / totalExpense) * 100 : 0,
    })),
    total: totalExpense,
  };
}

export default {
  getProfitLossData,
  getBalanceSheetData,
  getTrialBalanceData,
  getCashFlowData,
  getGeneralLedgerData,
  getARAgingData,
  getAPAgingData,
  getReportSummary,
  getAvailableDateRanges,
  getRevenueByAccount,
  getExpensesByAccount,
};

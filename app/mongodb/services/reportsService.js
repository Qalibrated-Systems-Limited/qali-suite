import Account from "../../models/account";
import JournalEntry from "../../models/JournalEntry";
import { ObjectId } from "mongodb";

import connectDB from "../../config/dbConnect";
import { getTenantContext, withTenantScope, buildTenantMatch } from "@/lib/utils/tenant-utils";

// ============================================
// REPORT SERVICE - FINANCIAL REPORTS
// ============================================

export class ReportService {
  /**
   * Generate Profit & Loss Statement (Income Statement)
   */
  static async generateProfitLoss(startDate, endDate) {
    await connectDB();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Single query for all P&L accounts
    const allAccounts = await Account.find(
      withTenantScope(
        { accountType: { $in: ["revenue", "expense"] }, isActive: true },
        companyId,
        isSuperAdmin,
      ),
    ).lean();

    // Single aggregation for all P&L accounts
    const allWithBalances = await this.calculateAccountBalances(
      allAccounts,
      startDate,
      endDate,
      companyId,
      isSuperAdmin,
    );

    // Split by account type in JS
    const revenueWithBalances = allWithBalances.filter(
      (a) => a.accountType === "revenue",
    );
    const expensesWithBalances = allWithBalances.filter(
      (a) => a.accountType === "expense",
    );

    const totalRevenue = revenueWithBalances.reduce(
      (sum, acc) => sum + acc.balance,
      0,
    );
    const totalExpenses = expensesWithBalances.reduce(
      (sum, acc) => sum + acc.balance,
      0,
    );

    const grossProfit = totalRevenue;
    const netIncome = totalRevenue - totalExpenses;
    const netMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;

    return {
      reportName: "Profit & Loss Statement",
      period: {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      },
      revenue: {
        accounts: revenueWithBalances,
        total: totalRevenue,
      },
      expenses: {
        accounts: expensesWithBalances,
        total: totalExpenses,
      },
      summary: {
        grossProfit,
        totalExpenses,
        netIncome,
        netMargin: netMargin.toFixed(2),
      },
    };
  }

  /**
   * Generate Balance Sheet
   */
  static async generateBalanceSheet(asOfDate) {
    await connectDB();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Fetch all account types (including revenue/expense for current year earnings)
    const allAccounts = await Account.find(
      withTenantScope(
        {
          accountType: { $in: ["asset", "liability", "equity", "revenue", "expense"] },
          isActive: true,
        },
        companyId,
        isSuperAdmin,
      ),
    ).lean();

    // Single aggregation for all accounts
    const allWithBalances = await this.calculateAccountBalances(
      allAccounts,
      null,
      asOfDate,
      companyId,
      isSuperAdmin,
    );

    // Split by account type
    const assetsWithBalances = allWithBalances.filter(
      (a) => a.accountType === "asset",
    );
    const liabilitiesWithBalances = allWithBalances.filter(
      (a) => a.accountType === "liability",
    );
    const equityWithBalances = allWithBalances.filter(
      (a) => a.accountType === "equity",
    );

    // Current Year Earnings = remaining revenue - expense balances
    // (closed periods already zeroed out via closing JEs into Retained Earnings)
    const currentRevenue = allWithBalances
      .filter((a) => a.accountType === "revenue")
      .reduce((sum, acc) => sum + acc.balance, 0);
    const currentExpenses = allWithBalances
      .filter((a) => a.accountType === "expense")
      .reduce((sum, acc) => sum + acc.balance, 0);
    const currentYearEarnings = currentRevenue - currentExpenses;

    if (Math.abs(currentYearEarnings) > 0.01) {
      equityWithBalances.push({
        accountCode: "CYE",
        accountName: "Current Year Earnings",
        accountType: "equity",
        subType: "earnings",
        balance: currentYearEarnings,
      });
    }

    const totalAssets = assetsWithBalances.reduce(
      (sum, acc) => sum + acc.balance,
      0,
    );
    const totalLiabilities = liabilitiesWithBalances.reduce(
      (sum, acc) => sum + acc.balance,
      0,
    );
    const totalEquity = equityWithBalances.reduce(
      (sum, acc) => sum + acc.balance,
      0,
    );

    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
    const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;

    return {
      reportName: "Balance Sheet",
      asOfDate: new Date(asOfDate),
      assets: {
        current: assetsWithBalances.filter((a) =>
          ["cash", "bank", "accounts_receivable", "inventory"].includes(
            a.subType,
          ),
        ),
        fixed: assetsWithBalances.filter((a) =>
          ["fixed_asset"].includes(a.subType),
        ),
        other: assetsWithBalances.filter(
          (a) =>
            ![
              "cash",
              "bank",
              "accounts_receivable",
              "inventory",
              "fixed_asset",
            ].includes(a.subType),
        ),
        total: totalAssets,
      },
      liabilities: {
        current: liabilitiesWithBalances.filter((l) =>
          ["accounts_payable", "tax_payable"].includes(l.subType),
        ),
        longTerm: liabilitiesWithBalances.filter((l) =>
          ["loan", "long_term_liability"].includes(l.subType),
        ),
        other: liabilitiesWithBalances.filter(
          (l) =>
            ![
              "accounts_payable",
              "tax_payable",
              "loan",
              "long_term_liability",
            ].includes(l.subType),
        ),
        total: totalLiabilities,
      },
      equity: {
        accounts: equityWithBalances,
        total: totalEquity,
      },
      summary: {
        totalAssets,
        totalLiabilities,
        totalEquity,
        totalLiabilitiesAndEquity,
        isBalanced,
        difference: totalAssets - totalLiabilitiesAndEquity,
      },
    };
  }

  /**
   * Generate Trial Balance
   */
  static async generateTrialBalance(asOfDate) {
    await connectDB();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    const tenantMatch = isSuperAdmin
      ? {}
      : { companyId: new ObjectId(companyId) };

    // Single aggregation: group all journal lines by accountId, then lookup account details
    const result = await JournalEntry.aggregate([
      {
        $match: {
          ...tenantMatch,
          status: "posted",
          entryDate: { $lte: new Date(asOfDate) },
        },
      },
      { $unwind: "$lines" },
      {
        $group: {
          _id: "$lines.accountId",
          totalDebit: { $sum: "$lines.debit" },
          totalCredit: { $sum: "$lines.credit" },
        },
      },
      {
        $lookup: {
          from: "accounts",
          localField: "_id",
          foreignField: "_id",
          as: "account",
        },
      },
      { $unwind: "$account" },
      {
        $match: {
          "account.canPost": true,
          "account.isActive": true,
        },
      },
      {
        $project: {
          _id: 0,
          accountCode: "$account.accountCode",
          accountName: "$account.accountName",
          accountType: "$account.accountType",
          debit: "$totalDebit",
          credit: "$totalCredit",
        },
      },
      { $sort: { accountCode: 1 } },
    ]);

    const totalDebits = result.reduce((sum, acc) => sum + acc.debit, 0);
    const totalCredits = result.reduce((sum, acc) => sum + acc.credit, 0);
    const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

    return {
      reportName: "Trial Balance",
      asOfDate: new Date(asOfDate),
      accounts: result,
      summary: {
        totalDebits,
        totalCredits,
        difference: totalDebits - totalCredits,
        isBalanced,
      },
    };
  }

  /**
   * Generate Cash Flow Statement
   */
  static async generateCashFlow(startDate, endDate) {
    await connectDB();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    // Get cash and bank accounts
    const cashAccounts = await Account.find(
      withTenantScope(
        { subType: { $in: ["cash", "bank", "mpesa"] }, isActive: true },
        companyId,
        isSuperAdmin,
      ),
    ).lean();

    const cashAccountIds = cashAccounts.map((a) => a._id);

    // Get all cash transactions
    const transactions = await JournalEntry.find(
      withTenantScope(
        {
          status: "posted",
          entryDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
          "lines.accountId": { $in: cashAccountIds },
        },
        companyId,
        isSuperAdmin,
      ),
    ).lean();

    // Build lookup for account details (need accountType and subType for categorization)
    const allAccountIds = new Set();
    for (const entry of transactions) {
      for (const line of entry.lines) {
        allAccountIds.add(line.accountId.toString());
      }
    }

    const accountDetails = await Account.find({
      _id: { $in: Array.from(allAccountIds) },
    }).lean();

    const accountMap = new Map();
    for (const acc of accountDetails) {
      accountMap.set(acc._id.toString(), acc);
    }

    // Categorize transactions based on contra account
    const operating = [];
    const investing = [];
    const financing = [];

    for (const entry of transactions) {
      // Find the cash line(s)
      const cashLines = entry.lines.filter((l) =>
        cashAccountIds.some((id) => id.equals(l.accountId)),
      );

      if (cashLines.length === 0) continue;

      // Calculate total cash impact
      const amount = cashLines.reduce(
        (sum, l) => sum + (l.debit || 0) - (l.credit || 0),
        0,
      );

      // Skip zero-amount entries
      if (Math.abs(amount) < 0.01) continue;

      // Find contra lines (non-cash accounts)
      const contraLines = entry.lines.filter(
        (l) => !cashAccountIds.some((id) => id.equals(l.accountId)),
      );

      // Check if this is a transfer between cash accounts (exclude from cash flow)
      if (contraLines.length === 0) {
        // Internal transfer between bank accounts — not a real cash flow
        continue;
      }

      const transaction = {
        date: entry.entryDate,
        description: entry.description,
        entryNumber: entry.entryNumber,
        amount,
      };

      // Categorize based on contra account characteristics
      let category = "operating"; // default

      for (const contra of contraLines) {
        const acc = accountMap.get(contra.accountId.toString());
        if (!acc) continue;

        // Investing: fixed assets, investments, other long-term assets
        if (
          acc.subType === "fixed_asset" ||
          acc.subType === "investment" ||
          (acc.accountType === "asset" && acc.subType === "other_asset")
        ) {
          category = "investing";
          break;
        }

        // Financing: loans, equity, owner drawings, dividends
        if (
          acc.subType === "loan" ||
          acc.subType === "long_term_liability" ||
          acc.accountType === "equity" ||
          acc.subType === "owner_drawings" ||
          acc.subType === "retained_earnings" ||
          acc.subType === "share_capital"
        ) {
          category = "financing";
          break;
        }

        // Operating: revenue, expense, AR, AP, inventory, tax (default)
      }

      if (category === "investing") {
        investing.push(transaction);
      } else if (category === "financing") {
        financing.push(transaction);
      } else {
        operating.push(transaction);
      }
    }

    const operatingCashFlow = operating.reduce((sum, t) => sum + t.amount, 0);
    const investingCashFlow = investing.reduce((sum, t) => sum + t.amount, 0);
    const financingCashFlow = financing.reduce((sum, t) => sum + t.amount, 0);

    const netCashFlow =
      operatingCashFlow + investingCashFlow + financingCashFlow;

    return {
      reportName: "Cash Flow Statement",
      period: {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      },
      operating: {
        transactions: operating,
        total: operatingCashFlow,
      },
      investing: {
        transactions: investing,
        total: investingCashFlow,
      },
      financing: {
        transactions: financing,
        total: financingCashFlow,
      },
      summary: {
        operatingCashFlow,
        investingCashFlow,
        financingCashFlow,
        netCashFlow,
      },
    };
  }

  /**
   * Generate General Ledger for an account
   */
  static async generateGeneralLedger(accountId, startDate, endDate) {
    await connectDB();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();

    const account = await Account.findOne(
      withTenantScope({ _id: accountId }, companyId, isSuperAdmin),
    );

    if (!account) {
      throw new Error("Account not found");
    }

    let query = {
      status: "posted",
      "lines.accountId": accountId,
    };

    if (startDate || endDate) {
      query.entryDate = {};
      if (startDate) {
        query.entryDate.$gte = new Date(startDate);
      }
      if (endDate) {
        query.entryDate.$lte = new Date(endDate);
      }
    }

    // Apply tenant scoping
    query = withTenantScope(query, companyId, isSuperAdmin);

    const entries = await JournalEntry.find(query)
      .sort({ entryDate: 1, entryNumber: 1 })
      .lean();

    // Calculate running balance
    let runningBalance = 0;
    const normalSide = ["asset", "expense"].includes(account.accountType)
      ? "debit"
      : "credit";

    const transactions = [];

    for (const entry of entries) {
      const line = entry.lines.find(
        (l) => l.accountId.toString() === accountId.toString(),
      );

      if (!line) continue;

      const debit = line.debit || 0;
      const credit = line.credit || 0;

      if (normalSide === "debit") {
        runningBalance += debit - credit;
      } else {
        runningBalance += credit - debit;
      }

      transactions.push({
        date: entry.entryDate,
        entryNumber: entry.entryNumber,
        description: entry.description,
        reference: entry.reference,
        debit,
        credit,
        balance: runningBalance,
      });
    }

    return {
      reportName: "General Ledger",
      account: {
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        normalBalanceSide: normalSide,
      },
      period: { startDate, endDate },
      transactions,
      summary: {
        openingBalance: 0,
        closingBalance: runningBalance,
        transactionCount: transactions.length,
      },
    };
  }

  /**
   * Generate Aged Receivables (AR Aging)
   */
  static async generateAgedReceivables(asOfDate = new Date()) {
    await connectDB();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

    const Account = (await import("../../models/account")).default;
    const arAccount = await Account.findOne(
      withTenantScope(
        { systemAccount: "accounts_receivable" },
        companyId,
        isSuperAdmin,
      ),
    );

    if (!arAccount) {
      throw new Error("Accounts Receivable account not configured");
    }

    const result = await JournalEntry.aggregate([
      {
        $match: {
          ...tenantMatch,
          status: "posted",
          entryDate: { $lte: new Date(asOfDate) },
          "party.type": "customer",
          isFullyPaid: false,
        },
      },
      { $unwind: "$lines" },
      { $match: { "lines.accountId": arAccount._id } },
      {
        $addFields: {
          amount: {
            $cond: [
              { $gt: ["$lines.debit", 0] },
              "$lines.debit",
              { $multiply: ["$lines.credit", -1] },
            ],
          },
          daysOverdue: {
            $cond: [
              { $ne: ["$dueDate", null] },
              {
                $floor: {
                  $divide: [
                    { $subtract: [asOfDate, "$dueDate"] },
                    1000 * 60 * 60 * 24,
                  ],
                },
              },
              0,
            ],
          },
        },
      },
      {
        $addFields: {
          agingBucket: {
            $switch: {
              branches: [
                { case: { $lte: ["$daysOverdue", 0] }, then: "current" },
                { case: { $lte: ["$daysOverdue", 30] }, then: "0-30" },
                { case: { $lte: ["$daysOverdue", 60] }, then: "31-60" },
                { case: { $lte: ["$daysOverdue", 90] }, then: "61-90" },
              ],
              default: "90+",
            },
          },
        },
      },
      {
        $group: {
          _id: {
            customerId: "$party.id",
            customerName: "$party.name",
          },
          current: {
            $sum: {
              $cond: [{ $eq: ["$agingBucket", "current"] }, "$amount", 0],
            },
          },
          days0_30: {
            $sum: { $cond: [{ $eq: ["$agingBucket", "0-30"] }, "$amount", 0] },
          },
          days31_60: {
            $sum: { $cond: [{ $eq: ["$agingBucket", "31-60"] }, "$amount", 0] },
          },
          days61_90: {
            $sum: { $cond: [{ $eq: ["$agingBucket", "61-90"] }, "$amount", 0] },
          },
          days90plus: {
            $sum: { $cond: [{ $eq: ["$agingBucket", "90+"] }, "$amount", 0] },
          },
          total: { $sum: "$amount" },
        },
      },
      {
        $project: {
          _id: 0,
          customerId: "$_id.customerId",
          customerName: "$_id.customerName",
          current: 1,
          days0_30: 1,
          days31_60: 1,
          days61_90: 1,
          days90plus: 1,
          total: 1,
        },
      },
      { $sort: { total: -1 } },
    ]);

    return {
      reportName: "Aged Receivables",
      asOfDate: new Date(asOfDate),
      customers: result,
      summary: {
        totalReceivables: result.reduce((sum, c) => sum + c.total, 0),
        current: result.reduce((sum, c) => sum + c.current, 0),
        overdue: result.reduce(
          (sum, c) =>
            sum + c.days0_30 + c.days31_60 + c.days61_90 + c.days90plus,
          0,
        ),
      },
    };
  }

  /**
   * Generate Aged Payables (AP Aging)
   */
  static async generateAgedPayables(asOfDate = new Date()) {
    await connectDB();

    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

    const Account = (await import("../../models/account")).default;
    const apAccount = await Account.findOne(
      withTenantScope(
        { systemAccount: "accounts_payable" },
        companyId,
        isSuperAdmin,
      ),
    );

    if (!apAccount) {
      throw new Error("Accounts Payable account not configured");
    }

    const result = await JournalEntry.aggregate([
      {
        $match: {
          ...tenantMatch,
          status: "posted",
          entryDate: { $lte: new Date(asOfDate) },
          "party.type": "supplier",
          isFullyPaid: false,
        },
      },
      { $unwind: "$lines" },
      { $match: { "lines.accountId": apAccount._id } },
      {
        $addFields: {
          amount: {
            $cond: [
              { $gt: ["$lines.credit", 0] },
              "$lines.credit",
              { $multiply: ["$lines.debit", -1] },
            ],
          },
          daysOverdue: {
            $cond: [
              { $ne: ["$dueDate", null] },
              {
                $floor: {
                  $divide: [
                    { $subtract: [asOfDate, "$dueDate"] },
                    1000 * 60 * 60 * 24,
                  ],
                },
              },
              0,
            ],
          },
        },
      },
      {
        $addFields: {
          agingBucket: {
            $switch: {
              branches: [
                { case: { $lte: ["$daysOverdue", 0] }, then: "current" },
                { case: { $lte: ["$daysOverdue", 30] }, then: "0-30" },
                { case: { $lte: ["$daysOverdue", 60] }, then: "31-60" },
                { case: { $lte: ["$daysOverdue", 90] }, then: "61-90" },
              ],
              default: "90+",
            },
          },
        },
      },
      {
        $group: {
          _id: {
            supplierId: "$party.id",
            supplierName: "$party.name",
          },
          current: {
            $sum: {
              $cond: [{ $eq: ["$agingBucket", "current"] }, "$amount", 0],
            },
          },
          days0_30: {
            $sum: { $cond: [{ $eq: ["$agingBucket", "0-30"] }, "$amount", 0] },
          },
          days31_60: {
            $sum: { $cond: [{ $eq: ["$agingBucket", "31-60"] }, "$amount", 0] },
          },
          days61_90: {
            $sum: { $cond: [{ $eq: ["$agingBucket", "61-90"] }, "$amount", 0] },
          },
          days90plus: {
            $sum: { $cond: [{ $eq: ["$agingBucket", "90+"] }, "$amount", 0] },
          },
          total: { $sum: "$amount" },
        },
      },
      {
        $project: {
          _id: 0,
          supplierId: "$_id.supplierId",
          supplierName: "$_id.supplierName",
          current: 1,
          days0_30: 1,
          days31_60: 1,
          days61_90: 1,
          days90plus: 1,
          total: 1,
        },
      },
      { $sort: { total: -1 } },
    ]);

    return {
      reportName: "Aged Payables",
      asOfDate: new Date(asOfDate),
      suppliers: result,
      summary: {
        totalPayables: result.reduce((sum, s) => sum + s.total, 0),
        current: result.reduce((sum, s) => sum + s.current, 0),
        overdue: result.reduce(
          (sum, s) =>
            sum + s.days0_30 + s.days31_60 + s.days61_90 + s.days90plus,
          0,
        ),
      },
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Calculate account balances for a list of accounts
   */
  static async calculateAccountBalances(
    accounts,
    startDate,
    endDate,
    companyId = null,
    isSuperAdmin = false,
  ) {
    if (accounts.length === 0) return [];

    const tenantMatch = isSuperAdmin
      ? {}
      : companyId
        ? { companyId: new ObjectId(companyId) }
        : {};
    const accountIds = accounts.map((a) => a._id);

    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const matchStage = {
      ...tenantMatch,
      status: "posted",
    };
    if (startDate || endDate) {
      matchStage.entryDate = dateFilter;
    }

    // Single aggregation for all accounts
    const results = await JournalEntry.aggregate([
      { $match: matchStage },
      { $unwind: "$lines" },
      { $match: { "lines.accountId": { $in: accountIds } } },
      {
        $group: {
          _id: "$lines.accountId",
          totalDebit: { $sum: "$lines.debit" },
          totalCredit: { $sum: "$lines.credit" },
        },
      },
    ]);

    // Build a lookup map from aggregation results
    const balanceMap = new Map();
    for (const row of results) {
      balanceMap.set(row._id.toString(), row);
    }

    // Map back to account details
    const accountsWithBalances = [];
    for (const account of accounts) {
      const row = balanceMap.get(account._id.toString());
      if (!row) continue;

      const { totalDebit, totalCredit } = row;
      const normalSide = ["asset", "expense"].includes(account.accountType)
        ? "debit"
        : "credit";

      const balance =
        normalSide === "debit"
          ? totalDebit - totalCredit
          : totalCredit - totalDebit;

      if (Math.abs(balance) > 0.01) {
        accountsWithBalances.push({
          accountCode: account.accountCode,
          accountName: account.accountName,
          accountType: account.accountType,
          subType: account.subType,
          balance,
        });
      }
    }

    return accountsWithBalances;
  }
}

export default ReportService;

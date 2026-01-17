import Account from "../../models/account";
import JournalEntry from "../../models/JournalEntry";

import connectDB from "../../config/dbConnect";

// ============================================
// REPORT SERVICE - FINANCIAL REPORTS
// ============================================
     
export class ReportService {
  /**
   * Generate Profit & Loss Statement (Income Statement)
   */
  static async generateProfitLoss(startDate, endDate) {
    await connectDB();

    // Get revenue and expense accounts
    const [revenueAccounts, expenseAccounts] = await Promise.all([
      Account.find({ accountType: "revenue", isActive: true }).lean(),
      Account.find({ accountType: "expense", isActive: true }).lean(),
    ]);

    // Calculate totals for each account
    const revenueWithBalances = await this.calculateAccountBalances(
      revenueAccounts,
      startDate,
      endDate
    );

    const expensesWithBalances = await this.calculateAccountBalances(
      expenseAccounts,
      startDate,
      endDate
    );

    const totalRevenue = revenueWithBalances.reduce(
      (sum, acc) => sum + acc.balance,
      0
    );
    const totalExpenses = expensesWithBalances.reduce(
      (sum, acc) => sum + acc.balance,
      0
    );

    const grossProfit = totalRevenue;
    const netIncome = totalRevenue - totalExpenses;
    const netMargin =
      totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;

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

    // Get all balance sheet accounts
    const [assets, liabilities, equity] = await Promise.all([
      Account.find({ accountType: "asset", isActive: true }).lean(),
      Account.find({ accountType: "liability", isActive: true }).lean(),
      Account.find({ accountType: "equity", isActive: true }).lean(),
    ]);

    // Calculate balances as of date
    const assetsWithBalances = await this.calculateAccountBalances(
      assets,
      null,
      asOfDate
    );

    const liabilitiesWithBalances = await this.calculateAccountBalances(
      liabilities,
      null,
      asOfDate
    );

    const equityWithBalances = await this.calculateAccountBalances(
      equity,
      null,
      asOfDate
    );

    const totalAssets = assetsWithBalances.reduce(
      (sum, acc) => sum + acc.balance,
      0
    );
    const totalLiabilities = liabilitiesWithBalances.reduce(
      (sum, acc) => sum + acc.balance,
      0
    );
    const totalEquity = equityWithBalances.reduce(
      (sum, acc) => sum + acc.balance,
      0
    );

    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
    const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;

    return {
      reportName: "Balance Sheet",
      asOfDate: new Date(asOfDate),
      assets: {
        current: assetsWithBalances.filter((a) =>
          ["cash", "bank", "accounts_receivable", "inventory"].includes(
            a.subType
          )
        ),
        fixed: assetsWithBalances.filter((a) =>
          ["fixed_asset"].includes(a.subType)
        ),
        other: assetsWithBalances.filter(
          (a) =>
            !["cash", "bank", "accounts_receivable", "inventory", "fixed_asset"].includes(
              a.subType
            )
        ),
        total: totalAssets,
      },
      liabilities: {
        current: liabilitiesWithBalances.filter((l) =>
          ["accounts_payable", "tax_payable"].includes(l.subType)
        ),
        longTerm: liabilitiesWithBalances.filter((l) =>
          ["loan", "long_term_liability"].includes(l.subType)
        ),
        other: liabilitiesWithBalances.filter(
          (l) =>
            !["accounts_payable", "tax_payable", "loan", "long_term_liability"].includes(
              l.subType
            )
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

    // Get all postable accounts
    const accounts = await Account.find({
      canPost: true,
      isActive: true,
    }).lean();

    // Calculate debits and credits for each account
    const accountsWithBalances = [];

    for (const account of accounts) {
      const result = await JournalEntry.aggregate([
        {
          $match: {
            status: "posted",
            entryDate: { $lte: new Date(asOfDate) },
          },
        },
        { $unwind: "$lines" },
        { $match: { "lines.accountId": account._id } },
        {
          $group: {
            _id: null,
            totalDebit: { $sum: "$lines.debit" },
            totalCredit: { $sum: "$lines.credit" },
          },
        },
      ]);

      if (result.length > 0) {
        const { totalDebit, totalCredit } = result[0];

        accountsWithBalances.push({
          accountCode: account.accountCode,
          accountName: account.accountName,
          accountType: account.accountType,
          debit: totalDebit,
          credit: totalCredit,
        });
      }
    }

    const totalDebits = accountsWithBalances.reduce(
      (sum, acc) => sum + acc.debit,
      0
    );
    const totalCredits = accountsWithBalances.reduce(
      (sum, acc) => sum + acc.credit,
      0
    );

    const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

    return {
      reportName: "Trial Balance",
      asOfDate: new Date(asOfDate),
      accounts: accountsWithBalances,
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

    // Get cash and bank accounts
    const cashAccounts = await Account.find({
      subType: { $in: ["cash", "bank", "mpesa"] },
      isActive: true,
    }).lean();

    const cashAccountIds = cashAccounts.map((a) => a._id);

    // Get all cash transactions
    const transactions = await JournalEntry.find({
      status: "posted",
      entryDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
      "lines.accountId": { $in: cashAccountIds },
    }).lean();

    // Categorize transactions
    const operating = [];
    const investing = [];
    const financing = [];

    for (const entry of transactions) {
      const cashLine = entry.lines.find((l) =>
        cashAccountIds.some((id) => id.equals(l.accountId))
      );

      if (!cashLine) continue;

      const amount = (cashLine.debit || 0) - (cashLine.credit || 0);

      const transaction = {
        date: entry.entryDate,
        description: entry.description,
        entryNumber: entry.entryNumber,
        amount,
      };

      // Categorize based on entry type
      if (
        ["sale", "purchase", "expense", "payment_received", "payment_made"].includes(
          entry.entryType
        )
      ) {
        operating.push(transaction);
      } else if (entry.entryType === "transfer") {
        // Could be investing or financing
        investing.push(transaction);
      } else {
        operating.push(transaction);
      }
    }

    const operatingCashFlow = operating.reduce(
      (sum, t) => sum + t.amount,
      0
    );
    const investingCashFlow = investing.reduce(
      (sum, t) => sum + t.amount,
      0
    );
    const financingCashFlow = financing.reduce(
      (sum, t) => sum + t.amount,
      0
    );

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

    const account = await Account.findById(accountId);

    if (!account) {
      throw new Error("Account not found");
    }

    const query = {
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
        (l) => l.accountId.toString() === accountId.toString()
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

    const Account = (await import("../models/account")).default;
    const arAccount = await Account.findOne({
      systemAccount: "accounts_receivable",
    });

    if (!arAccount) {
      throw new Error("Accounts Receivable account not configured");
    }

    const result = await JournalEntry.aggregate([
      {
        $match: {
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
            $sum: { $cond: [{ $eq: ["$agingBucket", "current"] }, "$amount", 0] },
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
          0
        ),
      },
    };
  }

  /**
   * Generate Aged Payables (AP Aging)
   */
  static async generateAgedPayables(asOfDate = new Date()) {
    await connectDB();

    const Account = (await import("../models/account")).default;
    const apAccount = await Account.findOne({
      systemAccount: "accounts_payable",
    });

    if (!apAccount) {
      throw new Error("Accounts Payable account not configured");
    }

    const result = await JournalEntry.aggregate([
      {
        $match: {
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
            $sum: { $cond: [{ $eq: ["$agingBucket", "current"] }, "$amount", 0] },
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
          0
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
  static async calculateAccountBalances(accounts, startDate, endDate) {
    const accountsWithBalances = [];

    for (const account of accounts) {
      const query = {
        status: "posted",
        "lines.accountId": account._id,
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

      const result = await JournalEntry.aggregate([
        { $match: query },
        { $unwind: "$lines" },
        { $match: { "lines.accountId": account._id } },
        {
          $group: {
            _id: null,
            totalDebit: { $sum: "$lines.debit" },
            totalCredit: { $sum: "$lines.credit" },
          },
        },
      ]);

      if (result.length > 0) {
        const { totalDebit, totalCredit } = result[0];

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
    }

    return accountsWithBalances;
  }
}

export default ReportService;
import FiscalPeriod from "../../models/fiscalPeriod";
import JournalEntry from "../../models/JournalEntry";
import Account from "../../models/account";
import connectDB from "../../config/dbConnect";

// ============================================
// FISCAL PERIOD SERVICE - PERIOD MANAGEMENT
// ============================================

export class FiscalPeriodService {
  /**
   * Create a new fiscal period
   */
  static async createFiscalPeriod(data, user) {
    await connectDB();

    // Validate dates
    if (new Date(data.startDate) >= new Date(data.endDate)) {
      throw new Error("End date must be after start date");
    }

    // Check for overlapping periods
    const overlapping = await FiscalPeriod.findOne({
      $or: [
        {
          startDate: { $lte: new Date(data.endDate) },
          endDate: { $gte: new Date(data.startDate) },
        },
      ],
    });

    if (overlapping) {
      throw new Error(
        `Period overlaps with existing period: ${overlapping.periodName}`
      );
    }

    // Generate period code (YYYY-MM or YYYY-QN)
    const startDate = new Date(data.startDate);
    const periodCode =
      data.periodType === "month"
        ? `${startDate.getFullYear()}-${String(
            startDate.getMonth() + 1
          ).padStart(2, "0")}`
        : `${startDate.getFullYear()}-Q${Math.ceil(
            (startDate.getMonth() + 1) / 3
          )}`;

    // Check if period code already exists
    const existingCode = await FiscalPeriod.findOne({ periodCode });
    if (existingCode) {
      throw new Error(
        `Period code ${periodCode} already exists. Use a different start date.`
      );
    }

    const fiscalPeriod = await FiscalPeriod.create({
      ...data,
      periodCode,
      status: "open",
      createdBy: {
        name: user.name,
        id: user.id,
      },
    });

    return fiscalPeriod;
  }

  /**
   * Get all fiscal periods
   */
  static async getFiscalPeriods(filters = {}) {
    await connectDB();

    const query = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.year) {
      query.year = filters.year;
    }

    if (filters.periodType) {
      query.periodType = filters.periodType;
    }

    const periods = await FiscalPeriod.find(query)
      .sort({ startDate: -1 })
      .lean();

    return periods;
  }

  /**
   * Get fiscal period by ID
   */
  static async getFiscalPeriodById(periodId) {
    await connectDB();

    const period = await FiscalPeriod.findById(periodId).lean();

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    return period;
  }

  /**
   * Get current/active period
   */
  static async getCurrentPeriod() {
    await connectDB();

    const now = new Date();

    const period = await FiscalPeriod.findOne({
      startDate: { $lte: now },
      endDate: { $gte: now },
      status: "open",
    }).lean();

    return period;
  }

  /**
   * Get period by date
   */
  static async getPeriodByDate(date) {
    await connectDB();

    const period = await FiscalPeriod.findOne({
      startDate: { $lte: new Date(date) },
      endDate: { $gte: new Date(date) },
    }).lean();

    return period;
  }

  /**
   * Update fiscal period
   */
  static async updateFiscalPeriod(periodId, data, user) {
    await connectDB();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    // Cannot update closed or locked periods
    if (period.status !== "open") {
      throw new Error(
        `Cannot update ${period.status} period. Reopen first if needed.`
      );
    }

    // Update fields
    Object.keys(data).forEach((key) => {
      if (key !== "periodCode" && key !== "status") {
        period[key] = data[key];
      }
    });

    period.lastModifiedBy = {
      name: user.name,
      id: user.id,
    };

    await period.save();

    return period;
  }

  /**
   * Close fiscal period
   */
  static async closeFiscalPeriod(periodId, user) {
    await connectDB();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    if (period.status !== "open") {
      throw new Error(`Cannot close period. Current status: ${period.status}`);
    }

    // Check for draft journal entries
    const draftCount = await JournalEntry.countDocuments({
      fiscalPeriodId: periodId,
      status: "draft",
    });

    if (draftCount > 0) {
      throw new Error(
        `Cannot close period. ${draftCount} draft journal entries exist. Please post or delete them first.`
      );
    }

    // Calculate statistics
    await this.calculatePeriodStatistics(periodId);

    // Calculate closing balances
    await this.calculateClosingBalances(periodId);

    // Create closing journal entry (close revenue/expense to retained earnings)
    const closingEntry = await this.createClosingJournalEntry(period, user);

    // Update period
    period.status = "closed";
    period.closedAt = new Date();
    period.closedBy = {
      name: user.name,
      id: user.id,
    };
    period.closingJournalEntryId = closingEntry?._id;
    period.lastModifiedBy = {
      name: user.name,
      id: user.id,
    };

    await period.save();

    return period;
  }

  /**
   * Reopen fiscal period
   */
  static async reopenFiscalPeriod(periodId, user, reason) {
    await connectDB();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    if (period.status !== "closed") {
      throw new Error("Can only reopen closed periods");
    }

    if (!reason || reason.trim().length === 0) {
      throw new Error("Reason is required to reopen a period");
    }

    // Update period
    period.status = "open";
    period.reopenedAt = new Date();
    period.reopenedBy = {
      name: user.name,
      id: user.id,
    };
    period.reopenReason = reason;
    period.reopenCount = (period.reopenCount || 0) + 1;
    period.lastModifiedBy = {
      name: user.name,
      id: user.id,
    };

    await period.save();

    return period;
  }

  /**
   * Lock fiscal period (prevent any changes)
   */
  static async lockFiscalPeriod(periodId, user, reason) {
    await connectDB();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    if (period.status !== "closed") {
      throw new Error("Can only lock closed periods");
    }

    period.status = "locked";
    period.lockedAt = new Date();
    period.lockedBy = {
      name: user.name,
      id: user.id,
    };
    period.lockReason = reason || "Period locked";
    period.lastModifiedBy = {
      name: user.name,
      id: user.id,
    };

    await period.save();

    return period;
  }

  /**
   * Calculate period statistics
   */
  static async calculatePeriodStatistics(periodId) {
    await connectDB();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    const [jeCount, revenueResult, expenseResult] = await Promise.all([
      // Count journal entries
      JournalEntry.countDocuments({
        fiscalPeriodId: periodId,
        status: "posted",
      }),

      // Calculate revenue
      this.calculateAccountTypeTotal(
        "revenue",
        period.startDate,
        period.endDate
      ),

      // Calculate expenses
      this.calculateAccountTypeTotal(
        "expense",
        period.startDate,
        period.endDate
      ),
    ]);

    const totalRevenue = revenueResult || 0;
    const totalExpenses = expenseResult || 0;
    const netIncome = totalRevenue - totalExpenses;

    period.statistics = {
      totalJournalEntries: jeCount,
      totalRevenue,
      totalExpenses,
      netIncome,
    };

    await period.save();

    return period.statistics;
  }

  /**
   * Calculate closing balances for all account types
   */
  static async calculateClosingBalances(periodId) {
    await connectDB();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    const accountTypes = ["asset", "liability", "equity", "revenue", "expense"];
    const closingBalances = {};

    for (const accountType of accountTypes) {
      const balance = await this.calculateAccountTypeBalance(
        accountType,
        period.endDate
      );
      closingBalances[
        `total${accountType.charAt(0).toUpperCase() + accountType.slice(1)}`
      ] = balance;
    }

    // Calculate net income
    closingBalances.netIncome =
      (closingBalances.totalRevenue || 0) - (closingBalances.totalExpense || 0);

    period.closingBalances = closingBalances;
    await period.save();

    return closingBalances;
  }

  /**
   * Create closing journal entry (close revenue/expense to retained earnings)
   */
  static async createClosingJournalEntry(period, user) {
    await connectDB();

    const netIncome =
      period.closingBalances?.netIncome || period.statistics?.netIncome || 0;

    // If no profit or loss, don't create closing entry
    if (Math.abs(netIncome) < 0.01) {
      return null;
    }

    // Get retained earnings account
    const retainedEarningsAccount = await Account.findOne({
      systemAccount: "retained_earnings",
    });

    if (!retainedEarningsAccount) {
      console.warn(
        "Retained Earnings account not configured. Skipping closing entry."
      );
      return null;
    }

    const JournalEntryService = (await import("./journalEntryService")).default;

    const lines = [];

    if (netIncome > 0) {
      // Profit: Credit Retained Earnings
      lines.push({
        accountId: retainedEarningsAccount._id,
        accountCode: retainedEarningsAccount.accountCode,
        accountName: retainedEarningsAccount.accountName,
        accountType: retainedEarningsAccount.accountType,
        debit: 0,
        credit: netIncome,
        description: `Net income for ${period.periodName}`,
      });

      // In a full implementation, you'd debit each revenue account
      // and credit each expense account. For simplicity, we're
      // just recording the net transfer.
    } else if (netIncome < 0) {
      // Loss: Debit Retained Earnings
      lines.push({
        accountId: retainedEarningsAccount._id,
        accountCode: retainedEarningsAccount.accountCode,
        accountName: retainedEarningsAccount.accountName,
        accountType: retainedEarningsAccount.accountType,
        debit: Math.abs(netIncome),
        credit: 0,
        description: `Net loss for ${period.periodName}`,
      });
    }

    if (lines.length === 0) {
      return null;
    }

    // For a balanced entry, we need both sides
    // This is simplified - in reality you'd close all revenue and expense accounts
    const revenueAccounts = await Account.find({
      accountType: "revenue",
      isActive: true,
      canPost: true,
    });

    // Close revenue accounts (debit revenue, credit retained earnings)
    // Simplified version - just one summary line
    if (netIncome > 0) {
      lines.push({
        accountId: revenueAccounts[0]?._id || retainedEarningsAccount._id,
        accountCode: revenueAccounts[0]?.accountCode || "TEMP",
        accountName: revenueAccounts[0]?.accountName || "Revenue Summary",
        accountType: "revenue",
        debit: netIncome,
        credit: 0,
        description: `Closing revenue for ${period.periodName}`,
      });
    }

    const entryData = {
      entryDate: period.endDate,
      entryType: "closing",
      description: `Closing entry for ${period.periodName}`,
      lines,
      relatedDocuments: {
        fiscalPeriodId: period._id,
        periodCode: period.periodCode,
      },
    };

    try {
      const closingEntry = await JournalEntryService.createJournalEntry(
        entryData,
        user
      );
      await JournalEntryService.postJournalEntry(closingEntry._id, user);

      return closingEntry;
    } catch (error) {
      console.error("Failed to create closing entry:", error.message);
      return null;
    }
  }

  /**
   * Create periods for a year
   */
  static async createYearPeriods(year, periodType = "month", user) {
    await connectDB();

    const periods = [];

    if (periodType === "month") {
      for (let month = 0; month < 12; month++) {
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

        const monthNames = [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ];

        try {
          const period = await this.createFiscalPeriod(
            {
              year,
              month: month + 1,
              periodName: `${monthNames[month]} ${year}`,
              startDate,
              endDate,
              periodType: "month",
            },
            user
          );
          periods.push(period);
        } catch (error) {
          console.error(
            `Failed to create period for ${monthNames[month]} ${year}:`,
            error.message
          );
        }
      }
    } else if (periodType === "quarter") {
      for (let quarter = 1; quarter <= 4; quarter++) {
        const startMonth = (quarter - 1) * 3;
        const startDate = new Date(year, startMonth, 1);
        const endDate = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);

        try {
          const period = await this.createFiscalPeriod(
            {
              year,
              month: startMonth + 1,
              periodName: `Q${quarter} ${year}`,
              startDate,
              endDate,
              periodType: "quarter",
            },
            user
          );
          periods.push(period);
        } catch (error) {
          console.error(`Failed to create Q${quarter} ${year}:`, error.message);
        }
      }
    }

    return periods;
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Calculate account type total for a period
   */
  static async calculateAccountTypeTotal(accountType, startDate, endDate) {
    const accounts = await Account.find({
      accountType,
      isActive: true,
      canPost: true,
    }).distinct("_id");

    const result = await JournalEntry.aggregate([
      {
        $match: {
          status: "posted",
          entryDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        },
      },
      { $unwind: "$lines" },
      { $match: { "lines.accountId": { $in: accounts } } },
      {
        $group: {
          _id: null,
          totalDebit: { $sum: "$lines.debit" },
          totalCredit: { $sum: "$lines.credit" },
        },
      },
    ]);

    if (result.length === 0) return 0;

    const { totalDebit, totalCredit } = result[0];
    const normalSide = ["asset", "expense"].includes(accountType)
      ? "debit"
      : "credit";

    return normalSide === "debit"
      ? totalDebit - totalCredit
      : totalCredit - totalDebit;
  }

  /**
   * Calculate account type balance as of a date
   */
  static async calculateAccountTypeBalance(accountType, asOfDate) {
    const accounts = await Account.find({
      accountType,
      isActive: true,
      canPost: true,
    }).distinct("_id");

    const result = await JournalEntry.aggregate([
      {
        $match: {
          status: "posted",
          entryDate: { $lte: new Date(asOfDate) },
        },
      },
      { $unwind: "$lines" },
      { $match: { "lines.accountId": { $in: accounts } } },
      {
        $group: {
          _id: null,
          totalDebit: { $sum: "$lines.debit" },
          totalCredit: { $sum: "$lines.credit" },
        },
      },
    ]);

    if (result.length === 0) return 0;

    const { totalDebit, totalCredit } = result[0];
    const normalSide = ["asset", "expense"].includes(accountType)
      ? "debit"
      : "credit";

    return normalSide === "debit"
      ? totalDebit - totalCredit
      : totalCredit - totalDebit;
  }

  /**
   * Get period summary
   */
  static async getPeriodSummary(periodId) {
    await connectDB();

    const period = await FiscalPeriod.findById(periodId).lean();

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    // Recalculate if needed
    if (!period.statistics || !period.closingBalances) {
      await this.calculatePeriodStatistics(periodId);
      await this.calculateClosingBalances(periodId);
      return await FiscalPeriod.findById(periodId).lean();
    }

    return period;
  }
}

export default FiscalPeriodService;

import FiscalPeriod from "../../models/fiscalPeriod";
import JournalEntry from "../../models/JournalEntry";
import Account from "../../models/account";
import connectDB from "../../config/dbConnect";
import {
  getTenantContext,
  withTenantScope,
  validateTenantAccess,
  getCompanyIdForCreate,
} from "@/lib/utils/tenant-utils";

// ============================================
// FISCAL PERIOD SERVICE - PERIOD MANAGEMENT
// Multi-tenant: All operations scoped by companyId
// ============================================

export class FiscalPeriodService {
  /**
   * Create a new fiscal period
   */
  static async createFiscalPeriod(data, user, explicitCompanyId = null) {
    await connectDB();
    const { companyId, isSuperAdmin } = await getTenantContext();
    const targetCompanyId = getCompanyIdForCreate(
      explicitCompanyId,
      companyId,
      isSuperAdmin
    );

    // Validate dates
    if (new Date(data.startDate) >= new Date(data.endDate)) {
      throw new Error("End date must be after start date");
    }

    // Check for overlapping periods within company
    const overlapping = await FiscalPeriod.findOne(
      withTenantScope(
        {
          $or: [
            {
              startDate: { $lte: new Date(data.endDate) },
              endDate: { $gte: new Date(data.startDate) },
            },
          ],
        },
        targetCompanyId,
        false
      )
    );

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

    // Check if period code already exists within company
    const existingCode = await FiscalPeriod.findOne(
      withTenantScope({ periodCode }, targetCompanyId, false)
    );
    if (existingCode) {
      throw new Error(
        `Period code ${periodCode} already exists. Use a different start date.`
      );
    }

    const fiscalPeriod = await FiscalPeriod.create({
      ...data,
      companyId: targetCompanyId,
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
    const { companyId, isSuperAdmin } = await getTenantContext();

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

    const periods = await FiscalPeriod.find(
      withTenantScope(query, companyId, isSuperAdmin)
    )
      .sort({ startDate: -1 })
      .lean();

    return periods;
  }

  /**
   * Get fiscal period by ID
   */
  static async getFiscalPeriodById(periodId) {
    await connectDB();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const period = await FiscalPeriod.findById(periodId).lean();

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    // Validate tenant access
    if (!validateTenantAccess(period, companyId, isSuperAdmin)) {
      throw new Error("Fiscal period not found");
    }

    return period;
  }

  /**
   * Get current/active period
   */
  static async getCurrentPeriod() {
    await connectDB();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const now = new Date();

    const period = await FiscalPeriod.findOne(
      withTenantScope(
        {
          startDate: { $lte: now },
          endDate: { $gte: now },
          status: "open",
        },
        companyId,
        isSuperAdmin
      )
    ).lean();

    return period;
  }

  /**
   * Get period by date
   */
  static async getPeriodByDate(date) {
    await connectDB();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const period = await FiscalPeriod.findOne(
      withTenantScope(
        {
          startDate: { $lte: new Date(date) },
          endDate: { $gte: new Date(date) },
        },
        companyId,
        isSuperAdmin
      )
    ).lean();

    return period;
  }

  /**
   * Update fiscal period
   */
  static async updateFiscalPeriod(periodId, data, user) {
    await connectDB();
    const { companyId, isSuperAdmin } = await getTenantContext();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    // Validate tenant access
    if (!validateTenantAccess(period, companyId, isSuperAdmin)) {
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
      if (key !== "periodCode" && key !== "status" && key !== "companyId") {
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
    const { companyId, isSuperAdmin } = await getTenantContext();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    // Validate tenant access
    if (!validateTenantAccess(period, companyId, isSuperAdmin)) {
      throw new Error("Fiscal period not found");
    }

    if (period.status !== "open") {
      throw new Error(`Cannot close period. Current status: ${period.status}`);
    }

    // Check for draft journal entries within company
    const draftCount = await JournalEntry.countDocuments(
      withTenantScope(
        { fiscalPeriodId: periodId, status: "draft" },
        companyId,
        isSuperAdmin
      )
    );

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
    const { companyId, isSuperAdmin } = await getTenantContext();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    // Validate tenant access
    if (!validateTenantAccess(period, companyId, isSuperAdmin)) {
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
    const { companyId, isSuperAdmin } = await getTenantContext();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    // Validate tenant access
    if (!validateTenantAccess(period, companyId, isSuperAdmin)) {
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
    const { companyId, isSuperAdmin } = await getTenantContext();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    // Validate tenant access
    if (!validateTenantAccess(period, companyId, isSuperAdmin)) {
      throw new Error("Fiscal period not found");
    }

    const [jeCount, revenueResult, expenseResult] = await Promise.all([
      // Count journal entries within company
      JournalEntry.countDocuments(
        withTenantScope(
          { fiscalPeriodId: periodId, status: "posted" },
          companyId,
          isSuperAdmin
        )
      ),

      // Calculate revenue
      this.calculateAccountTypeTotal(
        "revenue",
        period.startDate,
        period.endDate,
        companyId,
        isSuperAdmin
      ),

      // Calculate expenses
      this.calculateAccountTypeTotal(
        "expense",
        period.startDate,
        period.endDate,
        companyId,
        isSuperAdmin
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
    const { companyId, isSuperAdmin } = await getTenantContext();

    const period = await FiscalPeriod.findById(periodId);

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    // Validate tenant access
    if (!validateTenantAccess(period, companyId, isSuperAdmin)) {
      throw new Error("Fiscal period not found");
    }

    const accountTypes = ["asset", "liability", "equity", "revenue", "expense"];
    const closingBalances = {};

    for (const accountType of accountTypes) {
      const balance = await this.calculateAccountTypeBalance(
        accountType,
        period.endDate,
        companyId,
        isSuperAdmin
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
    const { companyId, isSuperAdmin } = await getTenantContext();

    const netIncome =
      period.closingBalances?.netIncome || period.statistics?.netIncome || 0;

    // If no profit or loss, don't create closing entry
    if (Math.abs(netIncome) < 0.01) {
      return null;
    }

    // Get retained earnings account within company
    const retainedEarningsAccount = await Account.findOne(
      withTenantScope(
        { systemAccount: "retained_earnings" },
        companyId,
        isSuperAdmin
      )
    );

    if (!retainedEarningsAccount) {
      console.warn(
        "Retained Earnings account not configured. Skipping closing entry."
      );
      return null;
    }

    const JournalService = (await import("./journalService")).default;

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
    const revenueAccounts = await Account.find(
      withTenantScope(
        { accountType: "revenue", isActive: true, canPost: true },
        companyId,
        isSuperAdmin
      )
    );

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
      const closingEntry = await JournalService.createJournalEntry(
        entryData,
        user
      );
      await JournalService.postJournalEntry(closingEntry._id, user);

      return closingEntry;
    } catch (error) {
      console.error("Failed to create closing entry:", error.message);
      return null;
    }
  }

  /**
   * Create periods for a year
   */
  static async createYearPeriods(year, periodType = "month", user, explicitCompanyId = null) {
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
            user,
            explicitCompanyId
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
            user,
            explicitCompanyId
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
  static async calculateAccountTypeTotal(
    accountType,
    startDate,
    endDate,
    companyId = null,
    isSuperAdmin = false
  ) {
    // If companyId not passed, get from context
    let tenantCompanyId = companyId;
    let tenantIsSuperAdmin = isSuperAdmin;
    if (!companyId) {
      const context = await getTenantContext();
      tenantCompanyId = context.companyId;
      tenantIsSuperAdmin = context.isSuperAdmin;
    }

    const accounts = await Account.find(
      withTenantScope(
        { accountType, isActive: true, canPost: true },
        tenantCompanyId,
        tenantIsSuperAdmin
      )
    ).distinct("_id");

    const result = await JournalEntry.aggregate([
      {
        $match: withTenantScope(
          {
            status: "posted",
            entryDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
          },
          tenantCompanyId,
          tenantIsSuperAdmin
        ),
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
  static async calculateAccountTypeBalance(
    accountType,
    asOfDate,
    companyId = null,
    isSuperAdmin = false
  ) {
    // If companyId not passed, get from context
    let tenantCompanyId = companyId;
    let tenantIsSuperAdmin = isSuperAdmin;
    if (!companyId) {
      const context = await getTenantContext();
      tenantCompanyId = context.companyId;
      tenantIsSuperAdmin = context.isSuperAdmin;
    }

    const accounts = await Account.find(
      withTenantScope(
        { accountType, isActive: true, canPost: true },
        tenantCompanyId,
        tenantIsSuperAdmin
      )
    ).distinct("_id");

    const result = await JournalEntry.aggregate([
      {
        $match: withTenantScope(
          {
            status: "posted",
            entryDate: { $lte: new Date(asOfDate) },
          },
          tenantCompanyId,
          tenantIsSuperAdmin
        ),
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
    const { companyId, isSuperAdmin } = await getTenantContext();

    const period = await FiscalPeriod.findById(periodId).lean();

    if (!period) {
      throw new Error("Fiscal period not found");
    }

    // Validate tenant access
    if (!validateTenantAccess(period, companyId, isSuperAdmin)) {
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

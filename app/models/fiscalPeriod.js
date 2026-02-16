import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// UTILITY: Format user for audit trail
// ============================================
function formatUserForAudit(user) {
  if (!user) {
    return { name: "System", id: "system" };
  }
  return {
    name: user.name || user.username || "Unknown User",
    id: user.id || user._id?.toString() || "unknown",
  };
}

// ============================================
// FISCAL PERIOD SCHEMA
// ============================================
const fiscalPeriodSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Period Identification
    year: {
      type: Number,
      required: [true, "Year is required"],
      min: [2018, "Year must be 2000 or later"],
      max: [2100, "Year must be 2100 or earlier"],
      index: true,
    },

    month: {
      type: Number,
      required: [true, "Month is required"],
      min: [1, "Month must be between 1 and 12"],
      max: [12, "Month must be between 1 and 12"],
      index: true,
    },

    periodName: {
      type: String,
      required: [true, "Period name is required"],
      // e.g., "January 2025", "Q1 2025"
      trim: true,
    },

    periodCode: {
      type: String,
      required: [true, "Period code is required"],
      // e.g., "2025-01", "2025-Q1"
      trim: true,
      uppercase: true,
    },

    // Period Dates
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
      index: true,
    },

    endDate: {
      type: Date,
      required: [true, "End date is required"],
      index: true,
      validate: {
        validator: function (value) {
          return value > this.startDate;
        },
        message: "End date must be after start date",
      },
    },

    // Period Type
    periodType: {
      type: String,
      enum: {
        values: ["month", "quarter", "year"],
        message: "{VALUE} is not a valid period type",
      },
      default: "month",
      index: true,
    },

    // Status
    status: {
      type: String,
      enum: {
        values: ["future", "open", "closed", "locked"],
        message: "{VALUE} is not a valid status",
      },
      default: "open",
      index: true,
    },

    // ============================================
    // FINANCIAL BALANCES
    // ============================================
    openingBalances: {
      totalAssets: {
        type: Number,
        default: 0,
      },
      totalLiabilities: {
        type: Number,
        default: 0,
      },
      totalEquity: {
        type: Number,
        default: 0,
      },
      totalRevenue: {
        type: Number,
        default: 0,
      },
      totalExpenses: {
        type: Number,
        default: 0,
      },
    },

    closingBalances: {
      totalAssets: {
        type: Number,
        default: 0,
      },
      totalLiabilities: {
        type: Number,
        default: 0,
      },
      totalEquity: {
        type: Number,
        default: 0,
      },
      totalRevenue: {
        type: Number,
        default: 0,
      },
      totalExpenses: {
        type: Number,
        default: 0,
      },
      netIncome: {
        type: Number,
        default: 0,
      },
    },

    // ============================================
    // PERIOD STATISTICS
    // ============================================
    statistics: {
      totalTransactions: {
        type: Number,
        default: 0,
      },
      totalJournalEntries: {
        type: Number,
        default: 0,
      },
      totalInvoices: {
        type: Number,
        default: 0,
      },
      totalBills: {
        type: Number,
        default: 0,
      },
      totalPayments: {
        type: Number,
        default: 0,
      },
      totalRevenue: {
        type: Number,
        default: 0,
      },
      totalExpenses: {
        type: Number,
        default: 0,
      },
      netIncome: {
        type: Number,
        default: 0,
      },
    },

    // ============================================
    // CLOSING PROCESS
    // ============================================
    closedAt: Date,

    closedBy: {
      name: String,
      id: String,
    },

    closingJournalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      // Entry that closes revenue/expense to retained earnings
    },

    lockedAt: Date,

    lockedBy: {
      name: String,
      id: String,
    },

    lockReason: String,

    // ============================================
    // REOPENING (IF NEEDED)
    // ============================================
    reopenedAt: Date,

    reopenedBy: {
      name: String,
      id: String,
    },

    reopenReason: String,

    reopenCount: {
      type: Number,
      default: 0,
    },

    // ============================================
    // NOTES & ATTACHMENTS
    // ============================================
    notes: String,

    attachments: [
      {
        filename: String,
        url: String,
        description: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
        uploadedBy: {
          name: String,
          id: String,
        },
      },
    ],

    // ============================================
    // AUDIT TRAIL
    // ============================================
    createdBy: {
      name: {
        type: String,
        required: [true, "Creator name is required"],
      },
      id: {
        type: String,
        required: [true, "Creator ID is required"],
      },
    },

    lastModifiedBy: {
      name: String,
      id: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ============================================
// COMPOUND INDEXES
// ============================================
// Unique period per company
fiscalPeriodSchema.index(
  { companyId: 1, year: -1, month: -1 },
  { unique: true },
);
fiscalPeriodSchema.index({ companyId: 1, periodCode: 1 }, { unique: true });
// Query indexes
fiscalPeriodSchema.index({ companyId: 1, status: 1, endDate: -1 });
fiscalPeriodSchema.index({ companyId: 1, periodType: 1, year: -1 });

// ============================================
// VIRTUALS
// ============================================
fiscalPeriodSchema.virtual("isOpen").get(function () {
  return this.status === "open";
});

fiscalPeriodSchema.virtual("isClosed").get(function () {
  return this.status === "closed" || this.status === "locked";
});

fiscalPeriodSchema.virtual("isLocked").get(function () {
  return this.status === "locked";
});

fiscalPeriodSchema.virtual("canPost").get(function () {
  return this.status === "open";
});

fiscalPeriodSchema.virtual("durationDays").get(function () {
  const diff = this.endDate - this.startDate;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

// ============================================
// METHODS
// ============================================

/**
 * Calculate period statistics
 */
fiscalPeriodSchema.methods.calculateStatistics = async function () {
  const JournalEntry = mongoose.model("JournalEntry");
  const Invoice = mongoose.model("Invoice");
  const Bill = mongoose.model("Bill");
  const Payment = mongoose.model("Payment");

  // Journal entries
  const jeCount = await JournalEntry.countDocuments({
    entryDate: { $gte: this.startDate, $lte: this.endDate },
    status: "posted",
  });

  // Invoices
  const invoiceCount = await Invoice.countDocuments({
    invoiceDate: { $gte: this.startDate, $lte: this.endDate },
    status: { $in: ["completed", "paid"] },
  });

  // Bills
  const billCount = await Bill.countDocuments({
    billDate: { $gte: this.startDate, $lte: this.endDate },
    status: { $in: ["approved", "paid"] },
  });

  // Payments
  const paymentCount = await Payment.countDocuments({
    paymentDate: { $gte: this.startDate, $lte: this.endDate },
    status: "confirmed",
  });

  // Revenue & Expenses (tenant-scoped)
  const Account = mongoose.model("Account");
  const companyId = this.companyId;
  const revenueAccounts = await Account.find({
    companyId, accountType: "revenue", isActive: true,
  }).distinct("_id");

  const expenseAccounts = await Account.find({
    companyId, accountType: "expense", isActive: true,
  }).distinct("_id");

  // Calculate revenue
  const revenueResult = await JournalEntry.aggregate([
    {
      $match: {
        entryDate: { $gte: this.startDate, $lte: this.endDate },
        status: "posted",
      },
    },
    { $unwind: "$lines" },
    {
      $match: {
        "lines.accountId": { $in: revenueAccounts },
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: { $subtract: ["$lines.credit", "$lines.debit"] },
        },
      },
    },
  ]);

  // Calculate expenses
  const expenseResult = await JournalEntry.aggregate([
    {
      $match: {
        entryDate: { $gte: this.startDate, $lte: this.endDate },
        status: "posted",
      },
    },
    { $unwind: "$lines" },
    {
      $match: {
        "lines.accountId": { $in: expenseAccounts },
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: { $subtract: ["$lines.debit", "$lines.credit"] },
        },
      },
    },
  ]);

  const totalRevenue = revenueResult[0]?.total || 0;
  const totalExpenses = expenseResult[0]?.total || 0;
  const netIncome = totalRevenue - totalExpenses;

  // Update statistics
  this.statistics = {
    totalTransactions: jeCount + invoiceCount + billCount + paymentCount,
    totalJournalEntries: jeCount,
    totalInvoices: invoiceCount,
    totalBills: billCount,
    totalPayments: paymentCount,
    totalRevenue,
    totalExpenses,
    netIncome,
  };

  await this.save();

  return this.statistics;
};

/**
 * Calculate closing balances
 */
fiscalPeriodSchema.methods.calculateClosingBalances = async function () {
  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  // Get all account types
  const accountTypes = ["asset", "liability", "equity", "revenue", "expense"];
  const closingBalances = {};

  for (const accountType of accountTypes) {
    const accounts = await Account.find({
      companyId: this.companyId, accountType, isActive: true,
    }).distinct("_id");

    const result = await JournalEntry.aggregate([
      {
        $match: {
          entryDate: { $lte: this.endDate },
          status: "posted",
        },
      },
      { $unwind: "$lines" },
      {
        $match: {
          "lines.accountId": { $in: accounts },
        },
      },
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
      const normalSide = ["asset", "expense"].includes(accountType)
        ? "debit"
        : "credit";
      const balance =
        normalSide === "debit"
          ? totalDebit - totalCredit
          : totalCredit - totalDebit;

      closingBalances[
        `total${accountType.charAt(0).toUpperCase() + accountType.slice(1)}`
      ] = balance;
    } else {
      closingBalances[
        `total${accountType.charAt(0).toUpperCase() + accountType.slice(1)}`
      ] = 0;
    }
  }

  // Calculate net income
  closingBalances.netIncome =
    (closingBalances.totalRevenue || 0) - (closingBalances.totalExpenses || 0);

  this.closingBalances = closingBalances;
  await this.save();

  return this.closingBalances;
};

/**
 * Close period
 */
fiscalPeriodSchema.methods.close = async function (closedBy) {
  if (this.status !== "open") {
    throw new Error(`Cannot close period. Current status: ${this.status}`);
  }

  // Check if there are any draft journal entries
  const JournalEntry = mongoose.model("JournalEntry");
  const draftCount = await JournalEntry.countDocuments({
    entryDate: { $gte: this.startDate, $lte: this.endDate },
    status: "draft",
  });

  if (draftCount > 0) {
    throw new Error(
      `Cannot close period. ${draftCount} draft journal entries exist. Please post or delete them first.`,
    );
  }

  const userInfo = formatUserForAudit(closedBy);

  // Calculate statistics
  await this.calculateStatistics();

  // Calculate closing balances
  await this.calculateClosingBalances();

  // Create closing journal entry (close revenue/expense to retained earnings)
  const closingEntry = await this.createClosingJournalEntry(userInfo);
  this.closingJournalEntryId = closingEntry._id;

  // Update status
  this.status = "closed";
  this.closedAt = new Date();
  this.closedBy = userInfo;
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

/**
 * Create closing journal entry (close revenue/expense to retained earnings)
 * This properly zeros out all revenue and expense accounts for the period
 */
fiscalPeriodSchema.methods.createClosingJournalEntry = async function (user) {
  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  // Get retained earnings account (tenant-scoped)
  const companyId = this.companyId;
  const retainedEarningsAccount = await Account.findOne({
    companyId, systemAccount: "retained_earnings",
  });

  if (!retainedEarningsAccount) {
    throw new Error("Retained Earnings account not configured");
  }

  const lines = [];

  // ============================================
  // 1. CLOSE ALL REVENUE ACCOUNTS
  // Revenue has normal CREDIT balance, so DEBIT to close
  // ============================================
  const revenueAccounts = await Account.find({
    companyId, accountType: "revenue", isActive: true,
  });

  for (const account of revenueAccounts) {
    const balanceResult = await JournalEntry.aggregate([
      {
        $match: {
          status: "posted",
          entryDate: { $gte: this.startDate, $lte: this.endDate },
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

    if (balanceResult.length > 0) {
      const { totalDebit, totalCredit } = balanceResult[0];
      const balance = totalCredit - totalDebit; // Revenue normal balance is CREDIT

      if (Math.abs(balance) > 0.01) {
        // DEBIT revenue to zero it out (opposite of normal credit balance)
        lines.push({
          accountId: account._id,
          accountCode: account.accountCode,
          accountName: account.accountName,
          accountType: "revenue",
          debit: balance > 0 ? balance : 0,
          credit: balance < 0 ? Math.abs(balance) : 0,
          description: `Close ${account.accountName}`,
        });
      }
    }
  }

  // ============================================
  // 2. CLOSE ALL EXPENSE ACCOUNTS
  // Expense has normal DEBIT balance, so CREDIT to close
  // ============================================
  const expenseAccounts = await Account.find({
    companyId, accountType: "expense", isActive: true,
  });

  for (const account of expenseAccounts) {
    const balanceResult = await JournalEntry.aggregate([
      {
        $match: {
          status: "posted",
          entryDate: { $gte: this.startDate, $lte: this.endDate },
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

    if (balanceResult.length > 0) {
      const { totalDebit, totalCredit } = balanceResult[0];
      const balance = totalDebit - totalCredit; // Expense normal balance is DEBIT

      if (Math.abs(balance) > 0.01) {
        // CREDIT expense to zero it out (opposite of normal debit balance)
        lines.push({
          accountId: account._id,
          accountCode: account.accountCode,
          accountName: account.accountName,
          accountType: "expense",
          debit: balance < 0 ? Math.abs(balance) : 0,
          credit: balance > 0 ? balance : 0,
          description: `Close ${account.accountName}`,
        });
      }
    }
  }

  // ============================================
  // 3. ADD RETAINED EARNINGS BALANCING LINE
  // ============================================
  const totalDebits = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredits = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  const netIncome = totalDebits - totalCredits;

  // If no activity, don't create entry
  if (lines.length === 0 || Math.abs(netIncome) < 0.01) {
    return null;
  }

  // Add balancing line to Retained Earnings
  // Profit (totalDebits > totalCredits): Credit Retained Earnings
  // Loss (totalCredits > totalDebits): Debit Retained Earnings
  lines.push({
    accountId: retainedEarningsAccount._id,
    accountCode: retainedEarningsAccount.accountCode,
    accountName: retainedEarningsAccount.accountName,
    accountType: "equity",
    debit: netIncome < 0 ? Math.abs(netIncome) : 0,
    credit: netIncome > 0 ? netIncome : 0,
    description: `Net ${netIncome > 0 ? "income" : "loss"} for ${this.periodName}`,
  });

  // ============================================
  // 4. VALIDATE BALANCE
  // ============================================
  const finalDebits = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const finalCredits = lines.reduce((sum, l) => sum + (l.credit || 0), 0);

  if (Math.abs(finalDebits - finalCredits) > 0.01) {
    throw new Error(
      `Closing entry unbalanced: Debits ${finalDebits.toFixed(2)} ≠ Credits ${finalCredits.toFixed(2)}`,
    );
  }

  // ============================================
  // 5. CREATE AND POST JOURNAL ENTRY
  // ============================================
  const { generateUniqueEntryNumber } =
    await import("@/lib/utils/server-utils");
  const entryNumber = await generateUniqueEntryNumber("CLOSE", this.companyId);

  const journalEntry = await JournalEntry.create({
    companyId: this.companyId,
    entryNumber,
    entryDate: this.endDate,
    entryType: "closing",
    description: `Closing entry for ${this.periodName}`,
    lines,
    relatedDocuments: {
      fiscalPeriodId: this._id,
      periodCode: this.periodCode,
    },
    status: "draft",
    createdBy: user,
  });

  // Post journal entry
  await journalEntry.post(user);

  return journalEntry;
};

/**
 * Lock period (prevent any changes)
 */
fiscalPeriodSchema.methods.lock = async function (lockedBy, reason) {
  if (this.status !== "closed") {
    throw new Error("Can only lock closed periods");
  }

  const userInfo = formatUserForAudit(lockedBy);

  this.status = "locked";
  this.lockedAt = new Date();
  this.lockedBy = userInfo;
  this.lockReason = reason || "Period locked";
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

/**
 * Reopen period (for corrections)
 */
fiscalPeriodSchema.methods.reopen = async function (reopenedBy, reason) {
  if (this.status !== "closed") {
    throw new Error("Can only reopen closed periods");
  }

  if (!reason || reason.trim().length === 0) {
    throw new Error("Reason is required to reopen a period");
  }

  const userInfo = formatUserForAudit(reopenedBy);

  this.status = "open";
  this.reopenedAt = new Date();
  this.reopenedBy = userInfo;
  this.reopenReason = reason;
  this.reopenCount += 1;
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get current period
 */
fiscalPeriodSchema.statics.getCurrentPeriod = function () {
  const now = new Date();
  return this.findOne({
    startDate: { $lte: now },
    endDate: { $gte: now },
  });
};

/**
 * Get open periods
 */
fiscalPeriodSchema.statics.getOpenPeriods = function () {
  return this.find({ status: "open" }).sort({ startDate: 1 });
};

/**
 * Get period by date
 */
fiscalPeriodSchema.statics.getPeriodByDate = function (date) {
  return this.findOne({
    startDate: { $lte: date },
    endDate: { $gte: date },
  });
};

/**
 * Get period by code
 */
fiscalPeriodSchema.statics.getByCode = function (periodCode) {
  return this.findOne({ periodCode });
};

/**
 * Create period for month
 */
fiscalPeriodSchema.statics.createMonthPeriod = async function (
  year,
  month,
  createdBy,
  companyId = null,
) {
  // Build query filter with companyId for tenant isolation
  const filter = { year, month };
  if (companyId) {
    filter.companyId = companyId;
  }

  // Check if period already exists for this company
  const existing = await this.findOne(filter);
  if (existing) {
    throw new Error(`Period ${year}-${month} already exists`);
  }

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

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);

  const userInfo = formatUserForAudit(createdBy);

  const periodData = {
    year,
    month,
    periodName: `${monthNames[month - 1]} ${year}`,
    periodCode: `${year}-${String(month).padStart(2, "0")}`,
    startDate,
    endDate,
    periodType: "month",
    status: "open",
    createdBy: userInfo,
  };

  // Add companyId if provided
  if (companyId) {
    periodData.companyId = companyId;
  }

  const period = await this.create(periodData);

  return period;
};

/**
 * Auto-create periods for year
 */
fiscalPeriodSchema.statics.createYearPeriods = async function (
  year,
  createdBy,
  companyId = null,
) {
  const periods = [];

  for (let month = 1; month <= 12; month++) {
    try {
      const period = await this.createMonthPeriod(
        year,
        month,
        createdBy,
        companyId,
      );
      periods.push(period);
    } catch (error) {
      console.error(`Failed to create period ${year}-${month}:`, error.message);
    }
  }

  return periods;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let FiscalPeriod = models?.FiscalPeriod;

if (!FiscalPeriod) {
  FiscalPeriod = mongoose.model("FiscalPeriod", fiscalPeriodSchema);
}

export default FiscalPeriod;

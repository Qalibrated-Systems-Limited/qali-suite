import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// JOURNAL ENTRY SCHEMA - DOUBLE-ENTRY ENGINE
// ============================================
const journalEntrySchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Entry Identification
    entryNumber: {
      type: String,
      required: [true, "Entry number is required"],
    },

    entryDate: {
      type: Date,
      required: [true, "Entry date is required"],
      index: true,
    },

    entryType: {
      type: String,
      required: [true, "Entry type is required"],
      enum: [
        // Existing
        "sale",
        "payment_received",
        "payment_made",
        "expense",
        "advance",
        "purchase",
        "adjustment",
        "opening_balance",
        "advance_settlement",
        "invoice_cancellation",
        "bill_cancellation",
        "closing",
        "transfer",
        // Added - ERP standard types
        "credit_note",
        "debit_note",
        "depreciation",
        "write_off",
        "payroll",
        "contra",
        "bank_entry",
        "cash_entry",
        "accrual",
        "revaluation",
        "tax",
        "inventory_adjustment",

        "other",
        //Other
        "liability_payment",
        "loan_disbursement",
        "goods_receipt",    // WB inbound — DR Inventory, CR GR/IR
        "goods_dispatch",   // WB outbound — DR COGS, CR Inventory
        "asset_disposal",   // Asset disposal — DR Bank/Loss, DR Accum Dep, CR Asset Cost, CR Gain
        "impairment",       // Asset impairment — DR Impairment Loss, CR Accumulated Depreciation
      ],
      index: true,
    },

    // Party Information (for AR/AP tracking)
    party: {
      type: {
        type: String,
        enum: ["customer", "supplier", "employee", "other", null],
      },
      id: {
        type: String,
        index: true,
      },
      name: String,
      email: String,
      phone: String,
    },

    // Due Date (for aging reports)
    dueDate: {
      type: Date,
      index: true,
    },

    // Journal Lines (MINIMUM 2 REQUIRED)
    lines: {
      type: [
        {
          accountId: {
            type: Schema.Types.ObjectId,
            ref: "Account",
            required: [true, "Account is required"],
          },
          accountCode: String, // Cached
          accountName: String, // Cached
          accountType: {
            type: String,
            enum: ["asset", "liability", "equity", "revenue", "expense"],
          },
          debit: {
            type: Number,
            default: 0,
            min: [0, "Debit cannot be negative"],
          },
          credit: {
            type: Number,
            default: 0,
            min: [0, "Credit cannot be negative"],
          },
          description: String,
        },
      ],
      validate: {
        validator: function (lines) {
          return lines && lines.length >= 2;
        },
        message: "Journal entry must have at least 2 lines",
      },
    },

    // Entry Details
    description: {
      type: String,
      required: [true, "Description is required"],
    },

    reference: String,

    // Related Documents
    relatedDocuments: {
      invoiceId: Schema.Types.ObjectId,
      invoiceNumber: String,
      paymentId: Schema.Types.ObjectId,
      paymentNumber: String,
      expenseId: Schema.Types.ObjectId,
      expenseNumber: String,
      billId: Schema.Types.ObjectId,
      billNumber: String,
      stockMovementId: Schema.Types.ObjectId,
      weighbridgeTicketId: Schema.Types.ObjectId,
      weighbridgeTicketNumber: String,
    },

    // Status & Control
    status: {
      type: String,
      enum: ["draft", "posted", "reversed"],
      default: "draft",
      index: true,
    },

    postedAt: Date,
    postedBy: {
      name: String,
      id: String,
    },

    reversedAt: Date,
    reversedBy: {
      name: String,
      id: String,
    },

    reversalEntryId: Schema.Types.ObjectId,
    originalEntryId: Schema.Types.ObjectId,

    // Payment Tracking
    isFullyPaid: {
      type: Boolean,
      default: false,
      index: true,
    },

    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },

    amountOutstanding: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Fiscal Period
    fiscalYear: {
      type: Number,
      index: true,
    },

    fiscalMonth: {
      type: Number,
      min: 1,
      max: 12,
    },

    fiscalPeriodId: Schema.Types.ObjectId,

    // Audit Trail
    createdBy: {
      name: String,
      id: String,
    },

    lastModifiedBy: {
      name: String,
      id: String,
    },

    notes: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ============================================
// COMPOUND INDEXES FOR QUERY EFFICIENCY
// ============================================
// Unique entry number per company
journalEntrySchema.index({ companyId: 1, entryNumber: 1 }, { unique: true });
// Query indexes - all prefixed with companyId for tenant isolation
journalEntrySchema.index({ companyId: 1, entryDate: -1, status: 1 });
journalEntrySchema.index({ companyId: 1, "party.type": 1, "party.id": 1 });
journalEntrySchema.index({ companyId: 1, dueDate: 1, isFullyPaid: 1 });
journalEntrySchema.index({ companyId: 1, "lines.accountId": 1 });
journalEntrySchema.index({ companyId: 1, fiscalYear: 1, fiscalMonth: 1 });
journalEntrySchema.index({ companyId: 1, entryType: 1, status: 1 });

// ============================================
// VIRTUALS
// ============================================
journalEntrySchema.virtual("totalDebits").get(function () {
  return this.lines.reduce((sum, line) => sum + (line.debit || 0), 0);
});

journalEntrySchema.virtual("totalCredits").get(function () {
  return this.lines.reduce((sum, line) => sum + (line.credit || 0), 0);
});

journalEntrySchema.virtual("isBalanced").get(function () {
  const debits = this.totalDebits;
  const credits = this.totalCredits;
  return Math.abs(debits - credits) < 0.01; // Allow 1 cent rounding
});

journalEntrySchema.virtual("daysOverdue").get(function () {
  if (!this.dueDate || this.isFullyPaid) return 0;
  const diff = new Date() - this.dueDate;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
});

journalEntrySchema.virtual("agingBucket").get(function () {
  const days = this.daysOverdue;
  if (days === 0) return "current";
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
});

// ============================================
// VALIDATION METHODS (BEFORE POSTING)
// ============================================

// Validate debits equal credits
journalEntrySchema.methods.validateBalance = function () {
  if (!this.isBalanced) {
    const debits = this.totalDebits.toFixed(2);
    const credits = this.totalCredits.toFixed(2);
    throw new Error(
      `Journal entry is not balanced! Debits: ${debits}, Credits: ${credits}`,
    );
  }
  return true;
};

// Validate each line has either debit OR credit (not both)
journalEntrySchema.methods.validateLines = function () {
  for (const line of this.lines) {
    if (line.debit > 0 && line.credit > 0) {
      throw new Error(
        `Line for account ${line.accountName} has both debit and credit. Only one is allowed.`,
      );
    }
    if (line.debit === 0 && line.credit === 0) {
      throw new Error(
        `Line for account ${line.accountName} has zero amount. Remove this line.`,
      );
    }
  }
  return true;
};

// Validate all accounts exist and can post
journalEntrySchema.methods.validateAccounts = async function (session = null) {
  const Account = mongoose.model("Account");

  // Batch fetch all accounts in one query
  const accountIds = this.lines.map((line) => line.accountId);
  let query = Account.find({ _id: { $in: accountIds } });
  if (session) query = query.session(session);
  const accounts = await query;
  const accountMap = new Map(accounts.map((a) => [a._id.toString(), a]));

  for (const line of this.lines) {
    const account = accountMap.get(line.accountId.toString());

    if (!account) {
      throw new Error(`Account ${line.accountId} not found`);
    }

    if (!account.canPost) {
      throw new Error(
        `Cannot post to header account: ${account.accountName}. Use a detail account.`,
      );
    }

    if (!account.isActive) {
      throw new Error(`Account ${account.accountName} is inactive`);
    }
  }

  return true;
};

// Validate fiscal period is open
journalEntrySchema.methods.validateFiscalPeriod = async function (
  session = null,
) {
  if (!this.fiscalPeriodId) return true;

  const FiscalPeriod = mongoose.model("FiscalPeriod");
  // Use session if provided (for transaction support)
  const period = session
    ? await FiscalPeriod.findById(this.fiscalPeriodId).session(session)
    : await FiscalPeriod.findById(this.fiscalPeriodId);

  if (!period) {
    throw new Error("Fiscal period not found");
  }

  if (period.status === "closed") {
    throw new Error(`Cannot post to closed fiscal period: ${period.name}`);
  }

  if (period.status === "locked") {
    throw new Error(`Cannot post to locked fiscal period: ${period.name}`);
  }

  return true;
};

// Complete validation before posting
journalEntrySchema.methods.validateBeforePosting = async function (
  session = null,
) {
  this.validateBalance();
  this.validateLines();
  await this.validateAccounts(session);
  await this.validateFiscalPeriod(session);
  return true;
};

// ============================================
// POST METHOD (WITH VALIDATION)
// ============================================
journalEntrySchema.methods.post = async function (postedBy, session = null) {
  if (this.status === "posted") {
    throw new Error("Journal entry is already posted");
  }

  if (this.status === "reversed") {
    throw new Error("Cannot post a reversed journal entry");
  }

  // Run all validations (pass session for transaction support)
  await this.validateBeforePosting(session);

  // Update status
  this.status = "posted";
  this.postedAt = new Date();
  this.postedBy = postedBy;

  await this.save({ session });

  // Update account balances (async - don't wait, outside transaction)
  this.updateAccountBalances().catch(console.error);

  return this;
};

// ============================================
// REVERSAL METHOD (WITH CHECKS)
// ============================================
journalEntrySchema.methods.reverse = async function (
  reversedBy,
  reason,
  session = null,
) {
  if (this.status !== "posted") {
    throw new Error("Can only reverse posted journal entries");
  }

  if (this.reversedAt) {
    throw new Error("Journal entry is already reversed");
  }

  // Check fiscal period
  await this.validateFiscalPeriod();

  // Create reversal entry
  const reversalLines = this.lines.map((line) => ({
    accountId: line.accountId,
    accountCode: line.accountCode,
    accountName: line.accountName,
    accountType: line.accountType,
    debit: line.credit, // Swap debit and credit
    credit: line.debit,
    description: `Reversal: ${line.description || ""}`,
  }));

  const JournalEntry = mongoose.model("JournalEntry");

  // Counter read — outside the txn is fine; the post() below will fail-fast
  // if a concurrent reversal claimed the same number (unique index on
  // entryNumber catches it).
  const lastEntry = await JournalEntry.findOne({
    entryNumber: /^JE-REV-/,
  })
    .sort({ entryNumber: -1 })
    .limit(1);

  let nextNum = 1;
  if (lastEntry) {
    const match = lastEntry.entryNumber.match(/JE-REV-(\d+)/);
    if (match) nextNum = parseInt(match[1]) + 1;
  }

  const reversalEntryNumber = `JE-REV-${String(nextNum).padStart(4, "0")}`;

  const reversalEntry = new JournalEntry({
    // Carry the tenant scope and fiscal period from the original.
    // Without this the reversal fails validation (companyId is required)
    // and silently bails inside bill.cancel(), leaving the bill in a
    // half-cancelled state. Caught by tests/edge-cases.test.mjs.
    companyId: this.companyId,
    fiscalPeriod: this.fiscalPeriod,
    entryNumber: reversalEntryNumber,
    entryDate: new Date(),
    entryType: "adjustment",
    description: `Reversal of ${this.entryNumber}: ${
      reason || "No reason provided"
    }`,
    lines: reversalLines,
    status: "draft",
    originalEntryId: this._id,
    createdBy: reversedBy,
  });
  await reversalEntry.save({ session });

  // Post the reversal inside the same txn
  await reversalEntry.post(reversedBy, session);

  // Mark original as reversed
  this.status = "reversed";
  this.reversedAt = new Date();
  this.reversedBy = reversedBy;
  this.reversalEntryId = reversalEntry._id;
  await this.save({ session });

  // Update account balances (async, deliberately outside txn)
  this.updateAccountBalances().catch(console.error);

  return reversalEntry;
};

// ============================================
// UPDATE ACCOUNT BALANCES
// ============================================
journalEntrySchema.methods.updateAccountBalances = async function () {
  const Account = mongoose.model("Account");
  const accountIds = [
    ...new Set(this.lines.map((l) => l.accountId.toString())),
  ];

  for (const accountId of accountIds) {
    const account = await Account.findById(accountId);
    if (account) {
      await account.calculateActualBalance();
    }
  }
};

// ============================================
// AGING REPORT METHODS
// ============================================

journalEntrySchema.statics.getARAgingReport = async function (
  asOfDate = new Date(),
  companyId = null,
) {
  const Account = mongoose.model("Account");
  const filter = { systemAccount: "accounts_receivable" };
  if (companyId) filter.companyId = companyId;
  const arAccount = await Account.findOne(filter);

  if (!arAccount) throw new Error("AR account not found");

  return this.aggregate([
    {
      $match: {
        status: "posted",
        entryDate: { $lte: asOfDate },
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
};

journalEntrySchema.statics.getAPAgingReport = async function (
  asOfDate = new Date(),
  companyId = null,
) {
  const Account = mongoose.model("Account");
  const filter = { systemAccount: "accounts_payable" };
  if (companyId) filter.companyId = companyId;
  const apAccount = await Account.findOne(filter);

  if (!apAccount) throw new Error("AP account not found");

  return this.aggregate([
    {
      $match: {
        status: "posted",
        entryDate: { $lte: asOfDate },
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
};

// Statement of Account
journalEntrySchema.statics.getStatementOfAccount = async function ({
  partyType,
  partyId,
  startDate,
  endDate,
  companyId = null,
}) {
  const Account = mongoose.model("Account");
  const accountSystem =
    partyType === "customer" ? "accounts_receivable" : "accounts_payable";
  const filter = { systemAccount: accountSystem };
  if (companyId) filter.companyId = companyId;
  const account = await Account.findOne(filter);

  if (!account) throw new Error(`${accountSystem} account not found`);

  const transactions = await this.find({
    status: "posted",
    "party.type": partyType,
    "party.id": partyId,
    entryDate: { $gte: startDate, $lte: endDate },
  })
    .sort({ entryDate: 1, entryNumber: 1 })
    .lean();

  let runningBalance = 0;
  const statement = transactions.map((entry) => {
    const line = entry.lines.find(
      (l) => l.accountId.toString() === account._id.toString(),
    );

    let debit = 0;
    let credit = 0;

    if (line) {
      debit = line.debit || 0;
      credit = line.credit || 0;
    }

    if (partyType === "customer") {
      runningBalance += debit - credit;
    } else {
      runningBalance += credit - debit;
    }

    return {
      date: entry.entryDate,
      entryNumber: entry.entryNumber,
      description: entry.description,
      reference: entry.reference,
      invoiceNumber: entry.relatedDocuments?.invoiceNumber,
      debit,
      credit,
      balance: runningBalance,
      dueDate: entry.dueDate,
      isFullyPaid: entry.isFullyPaid,
    };
  });

  return {
    partyType,
    partyId,
    partyName: transactions[0]?.party?.name || "Unknown",
    startDate,
    endDate,
    openingBalance: 0,
    closingBalance: runningBalance,
    transactions: statement,
  };
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let JournalEntry = models?.JournalEntry;

if (!JournalEntry) {
  JournalEntry = mongoose.model("JournalEntry", journalEntrySchema);
}

export default JournalEntry;

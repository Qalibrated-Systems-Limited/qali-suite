import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// HELPER: Derive company code from name
// ============================================
function deriveCompanyCode(name) {
  if (!name) return null;
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return words.slice(0, 4).map((w) => w[0]).join("").toUpperCase();
  }
  return name.slice(0, 3).toUpperCase();
}

// ============================================
// EXPENSE SCHEMA - BUSINESS EXPENSES
// ============================================
const expenseSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Expense Identification
    expenseNumber: {
      type: String,
      required: [true, "Expense number is required"],
    },

    expenseDate: {
      type: Date,
      required: [true, "Expense date is required"],
      index: true,
    },

    // Categorization
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: {
        values: [
          "utilities",
          "rent",
          "salaries",
          "transport",
          "office_supplies",
          "insurance",
          "maintenance",
          "marketing",
          "legal_professional",
          "bank_charges",
          "depreciation",
          "meals_entertainment",
          "telecommunications",
          "training",
          "materials",
          "subscriptions",
          "security",
          "cleaning",
          "licenses_permits",
          "printing_stationery",
          "courier_postage",
          "other",
        ],
        message: "{VALUE} is not a valid expense category",
      },
      index: true,
    },

    // Project (optional)
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      index: true,
    },
    project: {
      projectNumber: String,
      name: String,
    },
    // Cost code (optional — construction cost categorization)
    costCodeId: { type: Schema.Types.ObjectId, ref: "ProjectCostCode" },
    costCode: { code: String, name: String },

    // Linked fixed asset (optional — tag fuel/repair/maintenance/etc. to a
    // specific asset to track its running costs). Snapshots assetNumber/name
    // so display survives asset rename.
    asset: {
      id: { type: Schema.Types.ObjectId, ref: "Asset", default: null },
      assetNumber: { type: String, default: null },
      name: { type: String, default: null },
    },

    // Account (Expense account from COA)
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: [true, "Expense account is required"],
      index: true,
    },

    accountCode: String, // Cached
    accountName: String, // Cached

    // Amount
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0.01, "Amount must be greater than zero"],
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
    },

    // Tax
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    withholdingTax: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Totals
    subtotal: Number,
    total: Number,

    // Payment Details
    paymentMethod: {
      type: String,
      enum: ["cash", "mpesa", "bank_transfer", "cheque", "card", "unpaid"],
      default: "unpaid",
      index: true,
    },

    paidFrom: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      // Cash/Bank account used (if paid)
    },

    paidAt: Date,

    // Payee — a supplier OR an employee (advances/reimbursements booked
    // directly by accounts). partyType drives the JE party tag so employee
    // balances aggregate correctly (parties.js matches party.type).
    vendor: {
      id: String,
      partyType: {
        type: String,
        enum: ["supplier", "employee"],
        default: "supplier",
      },
      name: {
        type: String,
        required: [true, "Vendor name is required"],
      },
      phone: String,
      email: String,
      taxPin: String,
    },

    // Description & Reference
    description: {
      type: String,
      required: [true, "Description is required"],
    },

    reference: String,
    invoiceNumber: String,

    // Receipts/Attachments
    receipts: [
      {
        filename: String,
        url: String,
        publicId: String,
        resourceType: String,
        size: Number,
        mimeType: String,
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

    // Employee Reimbursement
    isReimbursable: {
      type: Boolean,
      default: false,
      index: true,
    },

    employeeId: String,
    employeeName: String,

    reimbursedAt: Date,

    reimbursedBy: {
      name: String,
      id: String,
    },

    // ── Status ─────────────────────────────────
    // Industry-standard: no approval workflow for expenses.
    // Paid expenses post immediately. Unpaid expenses post as accruals.
    //
    //   draft  → expense being entered (not yet posted)
    //   posted → JE created (DR Expense / CR Cash or Accrued Expenses)
    //   paid   → was unpaid, now payment recorded (clearing JE created)
    //   void   → reversed (JE reversed)
    //
    // Legacy statuses (pending, approved, rejected) are kept in the enum
    // for backward compatibility with existing data but are no longer
    // created by the current workflow.
    status: {
      type: String,
      enum: ["draft", "posted", "paid", "void", "pending", "approved", "rejected"],
      default: "draft",
      index: true,
    },

    // Payment tracking (separate from document status)
    paymentStatus: {
      type: String,
      enum: ["paid", "unpaid"],
      default: "unpaid",
      index: true,
    },

    // Legacy approval fields — kept for backward compat, not used in new flow
    submittedAt: Date,
    submittedBy: { name: String, id: String },
    approvedAt: Date,
    approvedBy: { name: String, id: String },
    rejectedAt: Date,
    rejectedBy: { name: String, id: String },
    rejectionReason: String,

    // New: posting audit trail
    postedAt: Date,
    postedBy: { name: String, id: String },
    voidedAt: Date,
    voidedBy: { name: String, id: String },
    voidReason: String,

    // Clearing JE when an unpaid expense is later paid
    clearingJournalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },

    // Accounting Link
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      index: true,
    },

    // Recurring Expense
    isRecurring: {
      type: Boolean,
      default: false,
    },

    recurringFrequency: {
      type: String,
      enum: ["monthly", "quarterly", "yearly", null],
    },

    nextRecurringDate: Date,
    parentRecurringExpenseId: Schema.Types.ObjectId,

    // Audit Trail
    createdBy: {
      name: {
        type: String,
        required: true,
      },
      id: {
        type: String,
        required: true,
      },
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
  }
);

// ============================================
// COMPOUND INDEXES FOR QUERY EFFICIENCY
// ============================================
// Unique expense number per company
expenseSchema.index({ companyId: 1, expenseNumber: 1 }, { unique: true });
// Query indexes - all prefixed with companyId for tenant isolation
expenseSchema.index({ companyId: 1, expenseDate: -1, status: 1 });
expenseSchema.index({ companyId: 1, category: 1, status: 1 });
expenseSchema.index({ companyId: 1, "vendor.id": 1 });
expenseSchema.index({ companyId: 1, isReimbursable: 1, employeeId: 1 });
expenseSchema.index({ companyId: 1, status: 1, approvedAt: -1 });
// Asset cost lookup — used by getAssetExpenses to roll up running costs
expenseSchema.index({ companyId: 1, "asset.id": 1, expenseDate: -1 });

// ============================================
// BACKFILL paymentStatus FOR OLD DATA
// ============================================
// Old expenses don't have paymentStatus in the DB.
// Mongoose defaults it to "unpaid" on read — wrong for
// expenses that were already paid in the old workflow.
// This hook corrects it at read time based on old fields.
expenseSchema.post("init", function () {
  if (this.paymentStatus) return; // already set — skip

  if (this.status === "paid") {
    this.paymentStatus = "paid";
  } else if (this.paymentMethod && this.paymentMethod !== "unpaid" && this.paidFrom) {
    this.paymentStatus = "paid";
  } else {
    this.paymentStatus = "unpaid";
  }
});

// ============================================
// VIRTUALS
// ============================================
expenseSchema.virtual("isPaid").get(function () {
  return this.paymentStatus === "paid" || this.status === "paid";
});

expenseSchema.virtual("needsApproval").get(function () {
  return this.status === "pending";
});

expenseSchema.virtual("hasReceipts").get(function () {
  return this.receipts && this.receipts.length > 0;
});

// ============================================
// VALIDATION METHODS
// ============================================

// Validate expense account
expenseSchema.methods.validateAccount = async function () {
  const Account = mongoose.model("Account");
  const account = await Account.findById(this.accountId);

  if (!account) {
    throw new Error("Expense account not found");
  }

  if (!account.isActive) {
    throw new Error(`Account ${account.accountName} is inactive`);
  }

  if (!account.canPost) {
    throw new Error(`Cannot post to header account: ${account.accountName}`);
  }

  if (account.accountType !== "expense") {
    throw new Error(
      `Account must be an expense account. Got: ${account.accountType}`
    );
  }

  return true;
};

// Validate amounts
expenseSchema.methods.validateAmounts = function () {
  // Calculate totals
  this.subtotal = this.amount;
  this.total = this.amount + (this.taxAmount || 0) - (this.withholdingTax || 0);

  if (this.total < 0) {
    throw new Error("Total amount cannot be negative");
  }

  return true;
};

// Validate payment account if paid
expenseSchema.methods.validatePaymentAccount = async function () {
  if (this.paymentMethod === "unpaid") return true;

  if (!this.paidFrom) {
    throw new Error("Payment account is required when expense is paid");
  }

  const Account = mongoose.model("Account");
  const account = await Account.findById(this.paidFrom);

  if (!account) {
    throw new Error("Payment account not found");
  }

  if (!account.isActive) {
    throw new Error(`Payment account ${account.accountName} is inactive`);
  }

  const validSubTypes = ["cash", "bank", "mpesa"];
  if (!validSubTypes.includes(account.subType)) {
    throw new Error(
      `Invalid payment account type. Must be cash, bank, or mpesa. Got: ${account.subType}`
    );
  }

  return true;
};

// Complete validation
expenseSchema.methods.validateBeforeApproval = async function () {
  await this.validateAccount();
  this.validateAmounts();
  return true;
};

// ============================================
// POST EXPENSE (one-step — replaces submit/approve)
// ============================================
// Called immediately on creation. Creates the JE and marks as posted.
//
// Paid expenses:   DR Expense / CR Cash|Bank|Mpesa
// Unpaid expenses: DR Expense / CR Accrued Expenses (liability)
//
expenseSchema.methods.post = async function (user) {
  if (this.status !== "draft") {
    throw new Error(`Cannot post expense in status: ${this.status}`);
  }

  await this.validateBeforeApproval();

  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  // Get expense account
  const expenseAccount = await Account.findById(this.accountId);
  if (!expenseAccount) throw new Error("Expense account not found");

  // Determine credit account based on payment status
  let creditAccount;
  const isPaid = this.paymentMethod !== "unpaid" && this.paidFrom;

  if (isPaid) {
    // Already paid → credit the payment account (cash/bank/mpesa)
    creditAccount = await Account.findById(this.paidFrom);
    if (!creditAccount) throw new Error("Payment account not found");
  } else {
    // Unpaid → credit Accrued Expenses (liability)
    creditAccount = await Account.findOne({
      companyId: this.companyId,
      systemAccount: "accrued_expenses",
    });
    if (!creditAccount) {
      throw new Error(
        "Accrued Expenses account not configured. " +
        "Add an account with system type 'accrued_expenses' to record unpaid expenses."
      );
    }
  }

  // Build JE lines
  let lines = [
    {
      accountId:   expenseAccount._id,
      accountCode: expenseAccount.accountCode,
      accountName: expenseAccount.accountName,
      accountType: expenseAccount.accountType,
      debit:       this.total,
      credit:      0,
      description: this.description,
    },
    {
      accountId:   creditAccount._id,
      accountCode: creditAccount.accountCode,
      accountName: creditAccount.accountName,
      accountType: creditAccount.accountType,
      debit:       0,
      credit:      this.total,
      description: isPaid
        ? `Payment for ${this.description}`
        : `Accrued — ${this.description}`,
    },
  ];

  // VAT line if applicable
  if (this.taxAmount > 0) {
    const vatAccount = await Account.findOne({
      companyId: this.companyId,
      systemAccount: "vat_input",
    });
    if (vatAccount) {
      lines[0].debit = this.amount; // expense net of VAT
      lines.splice(1, 0, {
        accountId:   vatAccount._id,
        accountCode: vatAccount.accountCode,
        accountName: vatAccount.accountName,
        accountType: vatAccount.accountType,
        debit:       this.taxAmount,
        credit:      0,
        description: `VAT on expense — ${this.description}`,
      });
    }
  }

  // Generate and create JE
  const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
  const entryNumber = await generateUniqueEntryNumber("EXP", this.companyId);

  const journalEntry = await JournalEntry.create({
    companyId:   this.companyId,
    entryNumber,
    entryDate:   this.expenseDate,
    entryType:   "expense",
    description: `Expense: ${this.description}`,
    reference:   this.reference,
    lines,
    party: {
      type: this.vendor.partyType || "supplier",
      id:   this.vendor.id,
      name: this.vendor.name,
    },
    relatedDocuments: {
      expenseId:     this._id,
      expenseNumber: this.expenseNumber,
    },
    status:    "draft",
    createdBy: this.createdBy || user, // attribute JE to original expense creator
  });

  await journalEntry.post(user); // posted by whoever triggered the action

  // Update expense
  // "paid"   = money already left the account (cash/mpesa/bank credited)
  // "posted" = accrual only (liability recognized, payment pending)
  this.journalEntryId = journalEntry._id;
  this.status         = isPaid ? "paid" : "posted";
  this.paymentStatus  = isPaid ? "paid" : "unpaid";
  this.postedAt       = new Date();
  this.postedBy       = user;
  if (isPaid) {
    this.paidAt = this.paidAt || new Date();
  }
  await this.save();

  return journalEntry;
};

// ============================================
// RECORD PAYMENT (for unpaid/accrued expenses)
// ============================================
// Creates a clearing JE: DR Accrued Expenses / CR Cash|Bank|Mpesa
//
expenseSchema.methods.recordPayment = async function (user, paymentDetails) {
  if (this.paymentStatus === "paid") {
    throw new Error("Expense is already paid");
  }

  if (!["posted", "approved"].includes(this.status)) {
    throw new Error(`Cannot record payment for expense in status: ${this.status}`);
  }

  if (!paymentDetails.paymentMethod || !paymentDetails.paidFrom) {
    throw new Error("Payment method and payment account are required");
  }

  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  const accruedAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "accrued_expenses",
  });
  const paymentAccount = await Account.findById(paymentDetails.paidFrom);

  if (!accruedAccount) throw new Error("Accrued Expenses account not configured");
  if (!paymentAccount) throw new Error("Payment account not found");

  // Clearing JE: DR Accrued Expenses / CR Cash|Bank
  const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
  const entryNumber = await generateUniqueEntryNumber("EXP-CLR", this.companyId);

  const clearingJE = await JournalEntry.create({
    companyId:   this.companyId,
    entryNumber,
    entryDate:   paymentDetails.paidAt || new Date(),
    entryType:   "expense",
    description: `Payment clearing — ${this.expenseNumber}: ${this.description}`,
    reference:   this.expenseNumber,
    lines: [
      {
        accountId:   accruedAccount._id,
        accountCode: accruedAccount.accountCode,
        accountName: accruedAccount.accountName,
        accountType: accruedAccount.accountType,
        debit:       this.total,
        credit:      0,
        description: `Clear accrual — ${this.description}`,
      },
      {
        accountId:   paymentAccount._id,
        accountCode: paymentAccount.accountCode,
        accountName: paymentAccount.accountName,
        accountType: paymentAccount.accountType,
        debit:       0,
        credit:      this.total,
        description: `Payment for ${this.description}`,
      },
    ],
    relatedDocuments: {
      expenseId:     this._id,
      expenseNumber: this.expenseNumber,
    },
    status:    "draft",
    createdBy: this.createdBy || user,
  });

  await clearingJE.post(user);

  this.clearingJournalEntryId = clearingJE._id;
  this.paymentMethod = paymentDetails.paymentMethod;
  this.paidFrom      = paymentDetails.paidFrom;
  this.paidAt        = paymentDetails.paidAt || new Date();
  this.paymentStatus = "paid";
  this.status        = "paid";
  await this.save();

  return clearingJE;
};

// ============================================
// STATIC METHODS
// ============================================

expenseSchema.statics.getPendingApproval = function () {
  return this.find({
    status: "pending",
  }).sort({ submittedAt: -1 });
};

expenseSchema.statics.getReimbursableExpenses = function (employeeId = null) {
  const query = {
    isReimbursable: true,
    status: "approved",
    reimbursedAt: null,
  };
  if (employeeId) query.employeeId = employeeId;

  return this.find(query).sort({ expenseDate: -1 });
};

expenseSchema.statics.getExpensesByCategory = function (startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        status: "paid",
        expenseDate: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: "$category",
        totalAmount: { $sum: "$total" },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { totalAmount: -1 },
    },
  ]);
};

// ============================================
// GENERATE EXPENSE NUMBER (Atomic with Verification)
// ============================================
expenseSchema.statics.generateExpenseNumber = async function (
  companyId = null,
  session = null
) {
  const ErpCounter = mongoose.model("ErpCounter");
  const Company = mongoose.model("Company");

  // Fetch company code for prefix
  let companyCode = null;
  if (companyId) {
    const company = await Company.findById(companyId).select("code name").lean();
    if (company) {
      // Use explicit code if set, otherwise derive from company name
      companyCode = company.code || deriveCompanyCode(company.name);
    }
  }

  const date = new Date();
  const yearMonth = `${date.getFullYear()}${String(
    date.getMonth() + 1
  ).padStart(2, "0")}`;

  // Build prefix with company code: EXP-{CODE}-{YYYYMM}
  const prefix = companyCode
    ? `EXP-${companyCode}-${yearMonth}`
    : `EXP-${yearMonth}`;

  // Counter key includes company code for tenant isolation
  const counterId = companyCode
    ? `exp-${companyCode.toLowerCase()}-${yearMonth}`
    : `exp-${yearMonth}`;

  // Build tenant filter for queries
  const tenantFilter = companyId ? { companyId } : {};

  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const seq = await ErpCounter.getNextSequence(counterId, companyId, session);
      const expenseNumber = `${prefix}-${String(seq).padStart(4, "0")}`;

      // Verify this number doesn't already exist
      let existsQuery = this.exists({ ...tenantFilter, expenseNumber });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;

      if (!exists) {
        return expenseNumber;
      }

      console.warn(`Expense number ${expenseNumber} already exists, retrying...`);
      continue;
    } catch (counterError) {
      console.warn(
        `Counter failed for ${counterId}, attempt ${attempt + 1}:`,
        counterError.message
      );

      // Escape special regex characters in prefix
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let findQuery = this.findOne({
        ...tenantFilter,
        expenseNumber: { $regex: `^${escapedPrefix}-\\d+$` },
      })
        .sort({ expenseNumber: -1 })
        .lean();
      if (session) findQuery = findQuery.session(session);
      const lastExpense = await findQuery;

      let nextNum = 1;
      if (lastExpense?.expenseNumber) {
        const match = lastExpense.expenseNumber.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }

      const expenseNumber = `${prefix}-${String(nextNum).padStart(4, "0")}`;

      let existsQuery = this.exists({ ...tenantFilter, expenseNumber });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;
      if (!exists) {
        return expenseNumber;
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 50 * Math.pow(2, attempt))
    );
  }

  // Ultimate fallback with timestamp
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Expense = models?.Expense;

if (!Expense) {
  Expense = mongoose.model("Expense", expenseSchema);
}

export default Expense;
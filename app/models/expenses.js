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
          "other",
        ],
        message: "{VALUE} is not a valid expense category",
      },
      index: true,
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

    // Vendor/Supplier
    vendor: {
      id: String,
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

    // Approval Workflow
    status: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected", "paid"],
      default: "draft",
      index: true,
    },

    submittedAt: Date,

    submittedBy: {
      name: String,
      id: String,
    },

    approvedAt: Date,

    approvedBy: {
      name: String,
      id: String,
    },

    rejectedAt: Date,

    rejectedBy: {
      name: String,
      id: String,
    },

    rejectionReason: String,

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

// ============================================
// VIRTUALS
// ============================================
expenseSchema.virtual("isPaid").get(function () {
  return this.status === "paid";
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
// SUBMIT FOR APPROVAL
// ============================================
expenseSchema.methods.submit = async function (submittedBy) {
  if (this.status !== "draft") {
    throw new Error("Can only submit draft expenses");
  }

  await this.validateBeforeApproval();

  this.status = "pending";
  this.submittedAt = new Date();
  this.submittedBy = submittedBy;
  await this.save();

  return this;
};

// ============================================
// APPROVE EXPENSE
// ============================================
expenseSchema.methods.approve = async function (approvedBy) {
  if (this.status !== "pending") {
    throw new Error("Can only approve pending expenses");
  }

  await this.validateBeforeApproval();

  this.status = "approved";
  this.approvedAt = new Date();
  this.approvedBy = approvedBy;
  await this.save();

  // If already paid, create journal entry
  if (this.paymentMethod !== "unpaid") {
    await this.createJournalEntry(approvedBy);
  }

  return this;
};

// ============================================
// REJECT EXPENSE
// ============================================
expenseSchema.methods.reject = async function (rejectedBy, reason) {
  if (this.status !== "pending") {
    throw new Error("Can only reject pending expenses");
  }

  this.status = "rejected";
  this.rejectedAt = new Date();
  this.rejectedBy = rejectedBy;
  this.rejectionReason = reason;
  await this.save();

  return this;
};

// ============================================
// MARK AS PAID
// ============================================
expenseSchema.methods.markAsPaid = async function (paidBy, paymentDetails) {
  if (this.status !== "approved") {
    throw new Error("Expense must be approved before marking as paid");
  }

  if (this.paymentMethod === "unpaid") {
    throw new Error("Payment method is required");
  }

  // Update payment details
  this.paidAt = paymentDetails.paidAt || new Date();
  this.paidFrom = paymentDetails.paidFrom;
  this.status = "paid";
  await this.save();

  // Create journal entry (skip if already exists - handles retry scenarios)
  if (!this.journalEntryId) {
    await this.createJournalEntry(paidBy);
  }

  return this;
};

// ============================================
// CREATE JOURNAL ENTRY
// ============================================
expenseSchema.methods.createJournalEntry = async function (user) {
  if (this.journalEntryId) {
    throw new Error("Journal entry already created for this expense");
  }

  if (this.paymentMethod === "unpaid" || !this.paidFrom) {
    throw new Error("Cannot create journal entry for unpaid expense");
  }

  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  // Get accounts
  const expenseAccount = await Account.findById(this.accountId);
  const paymentAccount = await Account.findById(this.paidFrom);

  if (!expenseAccount || !paymentAccount) {
    throw new Error("Accounts not found");
  }

  let lines = [
    {
      accountId: expenseAccount._id,
      accountCode: expenseAccount.accountCode,
      accountName: expenseAccount.accountName,
      accountType: expenseAccount.accountType,
      debit: this.total,
      credit: 0,
      description: this.description,
    },
    {
      accountId: paymentAccount._id,
      accountCode: paymentAccount.accountCode,
      accountName: paymentAccount.accountName,
      accountType: paymentAccount.accountType,
      debit: 0,
      credit: this.total,
      description: `Payment for ${this.description}`,
    },
  ];

  // Add tax lines if applicable
  if (this.taxAmount > 0) {
    const vatAccount = await Account.findOne({ companyId: this.companyId, systemAccount: "vat_output" });
    if (vatAccount) {
      // Adjust expense line
      lines[0].debit = this.amount;
      
      // Add VAT line
      lines.splice(1, 0, {
        accountId: vatAccount._id,
        accountCode: vatAccount.accountCode,
        accountName: vatAccount.accountName,
        accountType: vatAccount.accountType,
        debit: this.taxAmount,
        credit: 0,
        description: "VAT on expense",
      });
    }
  }

  // Generate entry number using centralized utility
  const { generateUniqueEntryNumber } = await import("@/lib/utils/server-utils");
  const entryNumber = await generateUniqueEntryNumber("EXP", this.companyId);

  // Create journal entry
  const journalEntry = await JournalEntry.create({
    companyId: this.companyId,
    entryNumber,
    entryDate: this.expenseDate,
    entryType: "expense",
    description: `Expense: ${this.description}`,
    reference: this.reference,
    lines,
    party: {
      type: "supplier",
      id: this.vendor.id,
      name: this.vendor.name,
    },
    relatedDocuments: {
      expenseId: this._id,
      expenseNumber: this.expenseNumber,
    },
    status: "draft",
    createdBy: user,
  });

  // Post journal entry
  await journalEntry.post(user);

  // Link to expense
  this.journalEntryId = journalEntry._id;
  await this.save();

  return journalEntry;
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
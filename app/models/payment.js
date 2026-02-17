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
// PAYMENT SCHEMA - MONEY IN/OUT TRACKING
// ============================================
// Design Principles:
// 1. Embed allocations - bounded (1-10), always read together
// 2. Cache account/party info - read-heavy, rarely changes
// 3. Separate collection - payments queried independently for reports
// 4. Fiscal period - accounting compliance
// ============================================

// Allocation sub-schema
const allocationSchema = new Schema(
  {
    documentType: {
      type: String,
      enum: ["invoice", "bill"],
      required: true,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    documentNumber: {
      type: String,
      required: true,
    },
    documentDate: Date,
    originalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },
    amountAllocated: {
      type: Number,
      required: true,
      min: [0.01, "Allocation must be positive"],
    },
  },
  { _id: true }
);

// ============================================
// MAIN PAYMENT SCHEMA
// ============================================
const paymentSchema = new Schema(
  {
    // ==========================================
    // IDENTIFICATION
    // ==========================================
    paymentNumber: {
      type: String,
      required: [true, "Payment number is required"],
      uppercase: true,
      trim: true,
      // Unique per company - see compound index below
    },

    paymentType: {
      type: String,
      required: [true, "Payment type is required"],
      enum: {
        values: ["received", "made"],
        message: "{VALUE} is not a valid payment type",
      },
      index: true,
    },

    paymentDate: {
      type: Date,
      required: [true, "Payment date is required"],
      index: true,
    },

    // Fiscal period for accounting (YYYY-MM)
    fiscalPeriod: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}$/, "Fiscal period must be YYYY-MM format"],
      index: true,
    },

    // ==========================================
    // MULTI-TENANCY
    // ==========================================
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // ==========================================
    // AMOUNT
    // ==========================================
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0.01, "Amount must be greater than zero"],
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
      enum: ["KES", "USD", "EUR", "GBP"],
    },

    // ==========================================
    // PAYMENT METHOD
    // ==========================================
    paymentMethod: {
      type: String,
      required: [true, "Payment method is required"],
      enum: {
        values: ["cash", "mpesa", "bank_transfer", "cheque", "card"],
        message: "{VALUE} is not a valid payment method",
      },
      index: true,
    },

    // M-Pesa specific (embedded - 1:1, always read together)
    mpesaDetails: {
      transactionCode: { type: String, uppercase: true, trim: true },
      phoneNumber: { type: String, trim: true },
      receiptNumber: { type: String, trim: true },
    },

    // Bank specific (embedded - 1:1, always read together)
    bankDetails: {
      bankName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      chequeNumber: { type: String, trim: true },
      transactionReference: { type: String, trim: true },
      clearingDate: Date,
    },

    // Card specific (embedded - 1:1)
    cardDetails: {
      last4Digits: String,
      cardType: { type: String, enum: ["visa", "mastercard", "amex", "other"] },
      approvalCode: String,
    },

    // ==========================================
    // PAYMENT ACCOUNT (Cash/Bank/M-Pesa from COA)
    // ==========================================
    account: {
      id: {
        type: Schema.Types.ObjectId,
        ref: "Account",
        required: [true, "Payment account is required"],
        index: true,
      },
      // Cached for display (rarely changes)
      code: { type: String, required: true },
      name: { type: String, required: true },
      subType: {
        type: String,
        enum: ["cash", "bank", "mpesa"],
        required: true,
      },
    },

    // ==========================================
    // PARTY (Customer or Supplier)
    // Snapshot at payment time - won't change
    // ==========================================
    party: {
      type: {
        type: String,
        enum: ["customer", "supplier"],
        required: [true, "Party type is required"],
      },
      partyId: {
        type: Schema.Types.ObjectId,
        ref: "Party",
        required: true,
        index: true,
      },
      // Cached snapshot
      name: {
        type: String,
        required: [true, "Party name is required"],
        trim: true,
      },
      email: { type: String, lowercase: true, trim: true },
      phone: { type: String, trim: true },
    },

    // ==========================================
    // ALLOCATIONS (Bounded: max 20 documents)
    // Embedded - always read together, lifecycle tied
    // ==========================================
    allocations: {
      type: [allocationSchema],
      validate: {
        validator: function (v) {
          return v.length <= 20;
        },
        message: "Cannot allocate to more than 20 documents",
      },
    },

    // Calculated amounts
    totalAllocated: {
      type: Number,
      default: 0,
      min: 0,
    },

    unappliedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ==========================================
    // REFERENCE & DESCRIPTION
    // ==========================================
    reference: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: 500,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    // ==========================================
    // STATUS & WORKFLOW
    // ==========================================
    status: {
      type: String,
      enum: ["draft", "pending_clearance", "confirmed", "cancelled"],
      default: "draft",
      index: true,
    },

    // ==========================================
    // ACCOUNTING LINK
    // ==========================================
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      index: true,
    },

    // ==========================================
    // BANK RECONCILIATION
    // ==========================================
    reconciliation: {
      isReconciled: { type: Boolean, default: false },
      reconciledAt: Date,
      reconciledBy: { name: String, id: String },
      statementReference: String,
    },

    // ==========================================
    // WORKFLOW TIMESTAMPS
    // ==========================================
    confirmedAt: Date,
    confirmedBy: { name: String, id: String },

    cancelledAt: Date,
    cancelledBy: { name: String, id: String },
    cancellationReason: String,

    // ==========================================
    // AUDIT
    // ==========================================
    createdBy: {
      name: { type: String, required: true },
      id: { type: String, required: true },
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
  }
);

// ============================================
// INDEXES
// ============================================
// Compound unique: paymentNumber unique per company
paymentSchema.index({ companyId: 1, paymentNumber: 1 }, { unique: true });

// Tenant-scoped query indexes
paymentSchema.index({ companyId: 1, paymentDate: -1, status: 1 });
paymentSchema.index({ companyId: 1, paymentType: 1, "party.partyId": 1 });
paymentSchema.index({ companyId: 1, fiscalPeriod: 1, paymentType: 1 });
paymentSchema.index({ companyId: 1, "reconciliation.isReconciled": 1, paymentMethod: 1 });
paymentSchema.index({ "allocations.documentId": 1 });

// ============================================
// VIRTUALS
// ============================================
paymentSchema.virtual("isFullyAllocated").get(function () {
  return Math.abs(this.unappliedAmount) < 0.01;
});

paymentSchema.virtual("hasAllocations").get(function () {
  return this.allocations && this.allocations.length > 0;
});

paymentSchema.virtual("canEdit").get(function () {
  return this.status === "draft";
});

paymentSchema.virtual("canConfirm").get(function () {
  return ["draft", "pending_clearance"].includes(this.status);
});

paymentSchema.virtual("canCancel").get(function () {
  return !this.reconciliation.isReconciled && this.status !== "cancelled";
});

paymentSchema.virtual("isCleared").get(function () {
  // For cheques - check if cleared
  if (this.paymentMethod === "cheque") {
    return !!this.bankDetails?.clearingDate;
  }
  return this.status === "confirmed";
});

// ============================================
// PRE-SAVE: Calculate allocations & fiscal period
// ============================================
paymentSchema.pre("save", function (next) {
  // Calculate totals
  this.totalAllocated = this.allocations.reduce(
    (sum, a) => sum + (a.amountAllocated || 0),
    0
  );
  this.unappliedAmount = Math.max(0, this.amount - this.totalAllocated);

  // Handle rounding
  if (Math.abs(this.unappliedAmount) < 0.01) {
    this.unappliedAmount = 0;
  }

  // Set fiscal period from payment date
  if (!this.fiscalPeriod && this.paymentDate) {
    const d = new Date(this.paymentDate);
    this.fiscalPeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
  }
});

// ============================================
// HELPER: Format user
// ============================================
function formatUser(user) {
  if (!user) return { name: "System", id: "system" };
  return {
    name: user.name || user.username || "Unknown",
    id: user.id || user._id?.toString() || "unknown",
  };
}

// ============================================
// METHOD: Validate before confirming
// ============================================
paymentSchema.methods.validateBeforeConfirm = async function () {
  const errors = [];

  // Check allocations don't exceed amount
  if (this.totalAllocated > this.amount + 0.01) {
    errors.push(
      `Total allocated (${this.totalAllocated}) exceeds payment amount (${this.amount})`
    );
  }

  // Validate party type matches allocation documents
  for (const alloc of this.allocations) {
    if (this.paymentType === "received" && alloc.documentType !== "invoice") {
      errors.push("Received payments can only be allocated to invoices");
    }
    if (this.paymentType === "made" && alloc.documentType !== "bill") {
      errors.push("Made payments can only be allocated to bills");
    }
  }

  // Validate account
  const Account = mongoose.model("Account");
  const account = await Account.findById(this.account.id);

  if (!account) {
    errors.push("Payment account not found");
  } else {
    if (!account.isActive) {
      errors.push(`Account ${account.accountName} is inactive`);
    }
    if (!["cash", "bank", "mpesa"].includes(account.subType)) {
      errors.push("Payment account must be cash, bank, or mpesa type");
    }
  }

  // Validate fiscal period is open
  const FiscalPeriod = mongoose.model("FiscalPeriod");
  const periodFilter = { periodCode: this.fiscalPeriod };
  if (this.companyId) {
    periodFilter.companyId = this.companyId;
  }
  const period = await FiscalPeriod.findOne(periodFilter);

  if (period && period.status === "closed") {
    errors.push(`Fiscal period ${this.fiscalPeriod} is closed`);
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return true;
};

// ============================================
// METHOD: Confirm payment (with transaction)
// If externalSession is provided, uses it (caller manages transaction)
// If not provided, creates and manages its own transaction
// ============================================
paymentSchema.methods.confirm = async function (user, externalSession = null) {
  if (!this.canConfirm) {
    throw new Error(`Cannot confirm payment in status: ${this.status}`);
  }

  // Validate before starting transaction
  await this.validateBeforeConfirm();

  const userInfo = formatUser(user);

  // If external session provided, use it without managing transaction
  if (externalSession) {
    return this._confirmWithSession(userInfo, externalSession);
  }

  // No external session - create and manage our own transaction
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    await this._confirmWithSession(userInfo, session);

    await session.commitTransaction();

    return this;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Internal helper for confirm logic
paymentSchema.methods._confirmWithSession = async function (userInfo, session) {
  // Create journal entry within transaction
  const journalEntry = await this.createJournalEntry(userInfo, session);

  // Update status
  this.status = "confirmed";
  this.confirmedAt = new Date();
  this.confirmedBy = userInfo;
  this.journalEntryId = journalEntry._id;
  this.lastModifiedBy = userInfo;

  await this.save({ session });

  // Update allocated documents within transaction
  await this.updateAllocatedDocuments(session);

  return this;
};

// ============================================
// METHOD: Create Journal Entry
// ============================================
paymentSchema.methods.createJournalEntry = async function (user, session = null) {
  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  const queryOptions = session ? { session } : {};

  // Get system accounts (tenant-scoped)
  const companyId = this.companyId;
  const [arAccount, apAccount] = await Promise.all([
    Account.findOne({ companyId, systemAccount: "accounts_receivable" }, null, queryOptions),
    Account.findOne({ companyId, systemAccount: "accounts_payable" }, null, queryOptions),
  ]);

  if (!arAccount || !apAccount) {
    throw new Error("AR/AP system accounts not configured");
  }

  const lines = [];

  if (this.paymentType === "received") {
    // Customer payment: DR Cash/Bank, CR Accounts Receivable
    lines.push({
      accountId: this.account.id,
      accountCode: this.account.code,
      accountName: this.account.name,
      accountType: "asset",
      debit: this.amount,
      credit: 0,
      description: `Payment from ${this.party.name}`,
    });

    lines.push({
      accountId: arAccount._id,
      accountCode: arAccount.accountCode,
      accountName: arAccount.accountName,
      accountType: "asset",
      debit: 0,
      credit: this.amount,
      description: `Reduce receivable - ${this.party.name}`,
    });
  } else {
    // Supplier payment: DR Accounts Payable, CR Cash/Bank
    lines.push({
      accountId: apAccount._id,
      accountCode: apAccount.accountCode,
      accountName: apAccount.accountName,
      accountType: "liability",
      debit: this.amount,
      credit: 0,
      description: `Reduce payable - ${this.party.name}`,
    });

    lines.push({
      accountId: this.account.id,
      accountCode: this.account.code,
      accountName: this.account.name,
      accountType: "asset",
      debit: 0,
      credit: this.amount,
      description: `Payment to ${this.party.name}`,
    });
  }

  // Generate entry number
  const prefix = this.paymentType === "received" ? "JE-REC" : "JE-PAY";
  const entryNumber = await this.constructor.generateJENumber(prefix, this.companyId, session);

  // Create and post
  const journalEntry = new JournalEntry({
    companyId: this.companyId,
    entryNumber,
    entryDate: this.paymentDate,
    entryType:
      this.paymentType === "received" ? "payment_received" : "payment_made",
    description: this.description,
    reference: this.reference,
    lines,
    party: {
      type: this.party.type,
      id: this.party.partyId.toString(),
      name: this.party.name,
    },
    fiscalPeriod: this.fiscalPeriod,
    relatedDocuments: {
      paymentId: this._id,
      paymentNumber: this.paymentNumber,
    },
    status: "draft",
    createdBy: user,
  });

  await journalEntry.save({ session });
  await journalEntry.post(user, session);

  return journalEntry;
};

// ============================================
// METHOD: Update allocated documents
// ============================================
paymentSchema.methods.updateAllocatedDocuments = async function (session = null) {
  const Invoice = mongoose.model("Invoice");
  const Bill = mongoose.model("Bill");

  const queryOptions = session ? { session } : {};

  // Prepare payment details to pass to recordPayment
  const paymentDetails = {
    paymentDate: this.paymentDate,
    paymentNumber: this.paymentNumber,
    paymentMethod: this.paymentMethod,
  };

  for (const alloc of this.allocations) {
    if (alloc.documentType === "invoice") {
      const invoice = await Invoice.findById(alloc.documentId).session(session);
      if (!invoice) {
        throw new Error(`Invoice ${alloc.documentNumber} not found`);
      }
      if (typeof invoice.recordPayment === "function") {
        await invoice.recordPayment(
          this._id,
          alloc.amountAllocated,
          paymentDetails,
          session
        );
      }
    } else if (alloc.documentType === "bill") {
      const bill = await Bill.findById(alloc.documentId).session(session);
      if (!bill) {
        throw new Error(`Bill ${alloc.documentNumber} not found`);
      }
      if (typeof bill.recordPayment === "function") {
        await bill.recordPayment(
          this._id,
          this.paymentNumber,
          alloc.amountAllocated,
          this.paymentMethod,
          this.reference ||
            this.mpesaDetails?.transactionCode ||
            this.bankDetails?.chequeNumber,
          this.paymentDate,
          this.confirmedBy,
          session
        );
      }
    }
  }
};

// ============================================
// METHOD: Cancel payment
// ============================================
paymentSchema.methods.cancel = async function (user, reason) {
  if (!this.canCancel) {
    throw new Error("Cannot cancel this payment");
  }

  if (this.reconciliation.isReconciled) {
    throw new Error("Cannot cancel a reconciled payment");
  }

  const userInfo = formatUser(user);

  // Reverse journal entry if exists
  if (this.journalEntryId) {
    const JournalEntry = mongoose.model("JournalEntry");
    const je = await JournalEntry.findById(this.journalEntryId);
    if (je && je.status === "posted") {
      await je.reverse(
        userInfo,
        `Payment ${this.paymentNumber} cancelled: ${reason}`
      );
    }
  }

  // Reverse allocations on documents
  await this.reverseAllocatedDocuments();

  this.status = "cancelled";
  this.cancelledAt = new Date();
  this.cancelledBy = userInfo;
  this.cancellationReason = reason || "No reason provided";
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

// ============================================
// METHOD: Reverse allocated documents
// ============================================
paymentSchema.methods.reverseAllocatedDocuments = async function () {
  const Invoice = mongoose.model("Invoice");
  const Bill = mongoose.model("Bill");

  for (const alloc of this.allocations) {
    try {
      if (alloc.documentType === "invoice") {
        const invoice = await Invoice.findById(alloc.documentId);
        if (invoice && typeof invoice.reversePayment === "function") {
          await invoice.reversePayment(this._id, alloc.amountAllocated);
        }
      } else if (alloc.documentType === "bill") {
        const bill = await Bill.findById(alloc.documentId);
        if (bill && typeof bill.reversePayment === "function") {
          await bill.reversePayment(this._id, alloc.amountAllocated);
        }
      }
    } catch (err) {
      console.error(
        `Failed to reverse ${alloc.documentType} ${alloc.documentNumber}:`,
        err
      );
    }
  }
};

// ============================================
// METHOD: Reconcile
// ============================================
paymentSchema.methods.reconcile = async function (user, statementRef) {
  if (this.status !== "confirmed") {
    throw new Error("Only confirmed payments can be reconciled");
  }

  const userInfo = formatUser(user);

  this.reconciliation.isReconciled = true;
  this.reconciliation.reconciledAt = new Date();
  this.reconciliation.reconciledBy = userInfo;
  this.reconciliation.statementReference = statementRef;
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

// ============================================
// STATIC: Generate Payment Number (Atomic with Verification)
// ============================================
paymentSchema.statics.generatePaymentNumber = async function (
  type,
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
  const typePrefix =
    type === "received" || type === "RECEIVED" ? "REC" : "MADE";
  const yearMonth = `${date.getFullYear()}${String(
    date.getMonth() + 1
  ).padStart(2, "0")}`;

  // Build pattern with company code prefix: PAY-{CODE}-{TYPE}-{YYYYMM}
  const pattern = companyCode
    ? `PAY-${companyCode}-${typePrefix}-${yearMonth}`
    : `PAY-${typePrefix}-${yearMonth}`;

  // Counter key includes company code for tenant isolation
  const counterKey = companyCode
    ? `payment-${companyCode.toLowerCase()}-${typePrefix.toLowerCase()}-${yearMonth}`
    : `payment-${typePrefix.toLowerCase()}-${yearMonth}`;

  // Include companyId in verification queries for tenant isolation
  const tenantFilter = companyId ? { companyId } : {};

  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Use atomic counter for sequence generation (tenant-scoped)
      const seq = await ErpCounter.getNextSequence(counterKey, companyId, session);
      const paymentNumber = `${pattern}-${String(seq).padStart(4, "0")}`;

      // Verify this number doesn't already exist within the same company
      // Use .session() method chaining instead of spreading into query filter
      let existsQuery = this.exists({ ...tenantFilter, paymentNumber });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;

      if (!exists) {
        return paymentNumber;
      }

      // Number exists - counter was stale, try again
      console.warn(
        `Payment number ${paymentNumber} already exists, retrying...`
      );
      continue;
    } catch (counterError) {
      // Counter failed - use query-based fallback
      console.warn(
        `Counter failed for ${counterKey}, attempt ${attempt + 1}:`,
        counterError.message
      );

      // Escape special regex characters in pattern
      const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let findQuery = this.findOne({
        ...tenantFilter,
        paymentNumber: { $regex: `^${escapedPattern}-\\d+$` },
      })
        .sort({ paymentNumber: -1 })
        .lean();
      if (session) findQuery = findQuery.session(session);
      const lastPayment = await findQuery;

      let nextNum = 1;
      if (lastPayment?.paymentNumber) {
        const match = lastPayment.paymentNumber.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }

      const paymentNumber = `${pattern}-${String(nextNum).padStart(4, "0")}`;

      let existsQuery = this.exists({ ...tenantFilter, paymentNumber });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;

      if (!exists) {
        return paymentNumber;
      }
    }

    // Exponential backoff before retry
    await new Promise((resolve) =>
      setTimeout(resolve, 50 * Math.pow(2, attempt))
    );
  }

  // Ultimate fallback with timestamp - guaranteed unique
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 4).toUpperCase();
  return `${pattern}-${timestamp}${random}`;
};

// ============================================
// STATIC: Generate JE Number - delegates to centralized utility
// ============================================
paymentSchema.statics.generateJENumber = async function (
  prefix,
  companyId = null,
  session = null
) {
  const { generateUniqueEntryNumber } = await import(
    "@/lib/utils/server-utils"
  );
  // Extract the type from prefix (e.g., "JE-REC" -> "REC", "JE-PAY" -> "PAY")
  const normalizedPrefix = prefix.replace(/^JE-/, "");
  return generateUniqueEntryNumber(normalizedPrefix, companyId, session);
};

// ============================================
// STATIC: Get by party
// ============================================
paymentSchema.statics.getByParty = function (partyId, type = null) {
  const query = {
    "party.partyId": partyId,
    status: "confirmed",
  };
  if (type) query.paymentType = type;

  return this.find(query).sort({ paymentDate: -1 });
};

// ============================================
// STATIC: Get unreconciled
// ============================================
paymentSchema.statics.getUnreconciled = function (method = null) {
  const query = {
    status: "confirmed",
    "reconciliation.isReconciled": false,
  };
  if (method) query.paymentMethod = method;

  return this.find(query).sort({ paymentDate: 1 });
};

// ============================================
// STATIC: Get by fiscal period
// ============================================
paymentSchema.statics.getByFiscalPeriod = function (period, type = null) {
  const query = {
    fiscalPeriod: period,
    status: { $ne: "cancelled" },
  };
  if (type) query.paymentType = type;

  return this.find(query).sort({ paymentDate: -1 });
};

// ============================================
// STATIC: Summary stats
// ============================================
paymentSchema.statics.getSummaryStats = async function (startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        paymentDate: { $gte: startDate, $lte: endDate },
        status: "confirmed",
      },
    },
    {
      $group: {
        _id: "$paymentType",
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Payment = models?.Payment;

if (!Payment) {
  Payment = mongoose.model("Payment", paymentSchema);
}

export default Payment;
export { Payment };

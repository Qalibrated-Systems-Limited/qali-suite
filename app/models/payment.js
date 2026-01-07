import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// PAYMENT SCHEMA - MONEY IN/OUT TRACKING
// ============================================
const paymentSchema = new Schema(
  {
    // Payment Identification
    paymentNumber: {
      type: String,
      required: [true, "Payment number is required"],
      unique: true,
      index: true,
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

    // Payment Method
    paymentMethod: {
      type: String,
      required: [true, "Payment method is required"],
      enum: {
        values: ["cash", "mpesa", "bank_transfer", "cheque", "card", "other"],
        message: "{VALUE} is not a valid payment method",
      },
      index: true,
    },

    // Method-specific Details
    mpesaDetails: {
      transactionCode: {
        type: String,
        uppercase: true,
      },
      phoneNumber: String,
      mpesaReceiptNumber: String,
    },

    bankDetails: {
      bankName: String,
      accountNumber: String,
      chequeNumber: String,
      transactionReference: String,
      clearingDate: Date, // When cheque cleared
    },

    cardDetails: {
      last4Digits: String,
      cardType: String,
      approvalCode: String,
    },

    // Account Used (Cash/Bank/M-Pesa account from COA)
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: [true, "Payment account is required"],
      index: true,
    },

    accountCode: String, // Cached
    accountName: String, // Cached

    // Party (Customer or Supplier)
    party: {
      type: {
        type: String,
        enum: ["customer", "supplier"],
        required: [true, "Party type is required"],
      },
      id: {
        type: Schema.Types.ObjectId,
        ref: "Party",
        required: true,
      },
      name: {
        type: String,
        required: [true, "Party name is required"],
      },
      email: String,
      phone: String,
    },

    // Payment Allocation (to invoices/bills)
    allocations: [
      {
        documentType: {
          type: String,
          enum: ["invoice", "bill"],
          required: true,
        },
        documentId: {
          type: Schema.Types.ObjectId,
          required: true,
          refPath: "allocations.documentType",
        },
        documentNumber: String,
        originalAmount: Number,
        amountAllocated: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],

    // Unapplied Amount
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

    // Reference & Description
    reference: String,

    description: {
      type: String,
      required: [true, "Description is required"],
    },

    notes: String,

    // Accounting Link
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      index: true,
    },

    // Bank Reconciliation
    isReconciled: {
      type: Boolean,
      default: false,
      index: true,
    },

    reconciledAt: Date,

    reconciledBy: {
      name: String,
      id: String,
    },

    // Status
    status: {
      type: String,
      enum: ["confirmed", "cancelled", "pending_clearance", "draft"],
      default: "pending_clearance",
      index: true,
    },

    cancelledAt: Date,

    cancelledBy: {
      name: String,
      id: String,
    },

    cancellationReason: String,

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
paymentSchema.index({ paymentDate: -1, status: 1 });
paymentSchema.index({ paymentType: 1, "party.id": 1 });
paymentSchema.index({ paymentMethod: 1, status: 1 });
paymentSchema.index({ isReconciled: 1, paymentMethod: 1 });
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

// ============================================
// VALIDATION METHODS
// ============================================

// Validate allocations don't exceed payment amount
paymentSchema.methods.validateAllocations = function () {
  const totalAllocated = this.allocations.reduce(
    (sum, alloc) => sum + (alloc.amountAllocated || 0),
    0
  );

  if (totalAllocated > this.amount) {
    throw new Error(
      `Total allocated (${totalAllocated}) exceeds payment amount (${this.amount})`
    );
  }

  this.totalAllocated = totalAllocated;
  this.unappliedAmount = this.amount - totalAllocated;

  return true;
};

// Validate party type matches allocations
paymentSchema.methods.validatePartyType = function () {
  for (const allocation of this.allocations) {
    if (
      this.paymentType === "received" &&
      allocation.documentType !== "invoice"
    ) {
      throw new Error("Payment received can only be allocated to invoices");
    }
    if (this.paymentType === "made" && allocation.documentType !== "bill") {
      throw new Error("Payment made can only be allocated to bills");
    }
  }
  return true;
};

// Validate payment account exists and is correct type
paymentSchema.methods.validateAccount = async function () {
  const Account = mongoose.model("Account");
  const account = await Account.findById(this.accountId);

  if (!account) {
    throw new Error("Payment account not found");
  }

  if (!account.isActive) {
    throw new Error(`Account ${account.accountName} is inactive`);
  }

  if (!account.canPost) {
    throw new Error(`Cannot post to header account: ${account.accountName}`);
  }

  // Validate account type
  const validSubTypes = ["cash", "bank", "mpesa"];
  if (!validSubTypes.includes(account.subType)) {
    throw new Error(
      `Invalid account type. Must be cash, bank, or mpesa account. Got: ${account.subType}`
    );
  }

  return true;
};

// Complete validation before confirming
paymentSchema.methods.validateBeforeConfirming = async function () {
  this.validateAllocations();
  this.validatePartyType();
  await this.validateAccount();
  return true;
};

// ============================================
// CONFIRM PAYMENT (CREATE JOURNAL ENTRY)
// ============================================
paymentSchema.methods.confirm = async function (confirmedBy) {
  if (this.status === "confirmed") {
    throw new Error("Payment is already confirmed");
  }

  if (this.status === "cancelled") {
    throw new Error("Cannot confirm a cancelled payment");
  }

  // Validate
  await this.validateBeforeConfirming();

  // Create journal entry
  const journalEntry = await this.createJournalEntry(confirmedBy);

  // Update status
  this.status = "confirmed";
  this.journalEntryId = journalEntry._id;
  await this.save();

  // Update invoice/bill payment status
  await this.updateDocumentPaymentStatus();

  return this;
};
paymentSchema.pre("findOneAndUpdate", function () {
  if (this.get("status") === "confirmed") {
    throw new Error("Cannot edit confirmed payment");
  }
});

// ============================================
// CREATE JOURNAL ENTRY FOR PAYMENT
// ============================================
paymentSchema.methods.createJournalEntry = async function (user) {
  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  // Get accounts
  const paymentAccount = await Account.findById(this.accountId);
  const arAccount = await Account.findOne({
    systemAccount: "accounts_receivable",
  });
  const apAccount = await Account.findOne({
    systemAccount: "accounts_payable",
  });

  if (!arAccount || !apAccount) {
    throw new Error("AR/AP accounts not configured");
  }

  let lines = [];

  if (this.paymentType === "received") {
    // Money IN: Debit Cash/Bank, Credit AR
    lines = [
      {
        accountId: paymentAccount._id,
        accountCode: paymentAccount.accountCode,
        accountName: paymentAccount.accountName,
        accountType: paymentAccount.accountType,
        debit: this.amount,
        credit: 0,
        description: `Payment received from ${this.party.name}`,
      },
      {
        accountId: arAccount._id,
        accountCode: arAccount.accountCode,
        accountName: arAccount.accountName,
        accountType: arAccount.accountType,
        debit: 0,
        credit: this.amount,
        description: `Payment from ${this.party.name}`,
      },
    ];
  } else {
    // Money OUT: Debit AP, Credit Cash/Bank
    lines = [
      {
        accountId: apAccount._id,
        accountCode: apAccount.accountCode,
        accountName: apAccount.accountName,
        accountType: apAccount.accountType,
        debit: this.amount,
        credit: 0,
        description: `Payment to ${this.party.name}`,
      },
      {
        accountId: paymentAccount._id,
        accountCode: paymentAccount.accountCode,
        accountName: paymentAccount.accountName,
        accountType: paymentAccount.accountType,
        debit: 0,
        credit: this.amount,
        description: `Payment made to ${this.party.name}`,
      },
    ];
  }

  // Generate entry number
  const lastEntry = await JournalEntry.findOne({
    entryType:
      this.paymentType === "received" ? "payment_received" : "payment_made",
  })
    .sort({ entryNumber: -1 })
    .limit(1);

  let nextNum = 1;
  if (lastEntry && lastEntry.entryNumber) {
    const match = lastEntry.entryNumber.match(/\d+$/);
    if (match) nextNum = parseInt(match[0]) + 1;
  }

  const prefix = this.paymentType === "received" ? "JE-PAY-REC" : "JE-PAY-MADE";
  const entryNumber = `${prefix}-${String(nextNum).padStart(4, "0")}`;

  // Create journal entry
  const journalEntry = await JournalEntry.create({
    entryNumber,
    entryDate: this.paymentDate,
    entryType:
      this.paymentType === "received" ? "payment_received" : "payment_made",
    description: this.description,
    reference: this.reference,
    lines,
    party: this.party,
    relatedDocuments: {
      paymentId: this._id,
      paymentNumber: this.paymentNumber,
    },
    status: "draft",
    createdBy: user,
  });

  // Post journal entry
  await journalEntry.post(user);

  return journalEntry;
};

// ============================================
// UPDATE INVOICE/BILL PAYMENT STATUS
// ============================================
paymentSchema.methods.updateDocumentPaymentStatus = async function () {
  const Invoice = mongoose.model("Invoice");
  const Bill = mongoose.model("Bill");

  for (const allocation of this.allocations) {
    if (allocation.documentType === "invoice") {
      const invoice = await Invoice.findById(allocation.documentId);
      if (invoice) {
        await invoice.recordPayment(this._id, allocation.amountAllocated);
      }
    } else if (allocation.documentType === "bill") {
      const bill = await Bill.findById(allocation.documentId);
      if (bill) {
        await bill.recordPayment(this._id, allocation.amountAllocated);
      }
    }
  }
};

// ============================================
// CANCEL PAYMENT
// ============================================
paymentSchema.methods.cancel = async function (cancelledBy, reason) {
  if (this.status === "cancelled") {
    throw new Error("Payment is already cancelled");
  }

  if (this.isReconciled) {
    throw new Error("Cannot cancel a reconciled payment");
  }

  // Reverse journal entry if exists
  if (this.journalEntryId) {
    const JournalEntry = mongoose.model("JournalEntry");
    const journalEntry = await JournalEntry.findById(this.journalEntryId);
    if (journalEntry && journalEntry.status === "posted") {
      await journalEntry.reverse(cancelledBy, reason);
    }
  }

  // Update status
  this.status = "cancelled";
  this.cancelledAt = new Date();
  this.cancelledBy = cancelledBy;
  this.cancellationReason = reason;
  await this.save();

  return this;
};

// ============================================
// STATIC METHODS
// ============================================

paymentSchema.statics.getUnreconciledPayments = function (
  paymentMethod = null
) {
  const query = {
    isReconciled: false,
    status: "confirmed",
  };
  if (paymentMethod) query.paymentMethod = paymentMethod;

  return this.find(query).sort({ paymentDate: -1 });
};

paymentSchema.statics.getPaymentsByParty = function (
  partyId,
  paymentType = null
) {
  const query = {
    "party.id": partyId,
    status: "confirmed",
  };
  if (paymentType) query.paymentType = paymentType;

  return this.find(query).sort({ paymentDate: -1 });
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

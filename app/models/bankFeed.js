import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// BANK STATEMENT SCHEMA
// Represents an uploaded bank statement file
// ============================================
const bankStatementSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Which bank account this statement is for
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: [true, "Bank account is required"],
      index: true,
    },

    // File information
    fileName: {
      type: String,
      required: true,
    },

    // Statement period
    statementPeriod: {
      startDate: Date,
      endDate: Date,
    },

    // Processing status
    status: {
      type: String,
      enum: ["processing", "ready", "completed", "error"],
      default: "processing",
      index: true,
    },

    // Statistics
    stats: {
      totalLines: { type: Number, default: 0 },
      allocatedLines: { type: Number, default: 0 },
      excludedLines: { type: Number, default: 0 },
      unallocatedLines: { type: Number, default: 0 },
      totalDebits: { type: Number, default: 0 },
      totalCredits: { type: Number, default: 0 },
    },

    // ──────────────────────────────────────────
    // BALANCE RECONCILIATION
    // ──────────────────────────────────────────
    // Reported opening balance from the statement (first line's running
    // balance minus that line's net amount, or user-entered if the file
    // has no balance column).
    openingBalance: { type: Number, default: null },
    // Reported closing balance from the statement (last line's running
    // balance — the bank's authoritative end-of-period number).
    closingBalance: { type: Number, default: null },
    // How the balances were obtained — drives the UI confidence pill.
    //   "from_file"   = parsed from runningBalance column
    //   "manual"      = user entered after import
    //   "unavailable" = no balance column and user hasn't entered yet
    balanceSource: {
      type: String,
      enum: ["from_file", "manual", "unavailable"],
      default: "unavailable",
    },

    // Column mapping used during import
    columnMapping: {
      date: String,
      description: String,
      reference: String,
      debit: String,
      credit: String,
      amount: String, // Some banks use single amount column
      balance: String,
    },

    // Date format used (e.g., "DD/MM/YYYY", "MM/DD/YYYY")
    dateFormat: {
      type: String,
      default: "DD/MM/YYYY",
    },

    // Error message if status is "error"
    errorMessage: String,

    // Duplicate detection - hash of file content
    contentHash: {
      type: String,
      index: true,
    },

    // Audit
    uploadedBy: {
      id: String,
      name: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
bankStatementSchema.index({ companyId: 1, createdAt: -1 });
bankStatementSchema.index({ companyId: 1, bankAccountId: 1, status: 1 });
// Unique hash per company to prevent duplicate uploads
bankStatementSchema.index({ companyId: 1, contentHash: 1 }, { unique: true, sparse: true });

// ============================================
// BANK FEED LINE SCHEMA
// Individual transaction from a bank statement
// ============================================
const bankFeedLineSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Parent statement
    statementId: {
      type: Schema.Types.ObjectId,
      ref: "BankStatement",
      required: true,
      index: true,
    },

    // Bank account
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },

    // ============================================
    // RAW DATA FROM BANK STATEMENT
    // ============================================
    transactionDate: {
      type: Date,
      required: true,
      index: true,
    },

    description: {
      type: String,
      required: true,
    },

    reference: String,

    // Money out (positive number)
    debitAmount: {
      type: Number,
      default: 0,
    },

    // Money in (positive number)
    creditAmount: {
      type: Number,
      default: 0,
    },

    // Running balance from statement
    runningBalance: Number,

    // Original row data (for reference)
    rawData: Schema.Types.Mixed,

    // Row number in original file
    rowNumber: Number,

    // Duplicate detection - unique hash per line
    // Hash of: bankAccountId + date + description + debit + credit
    lineHash: {
      type: String,
      index: true,
    },

    // ============================================
    // ALLOCATION STATUS
    // ============================================
    status: {
      type: String,
      enum: ["unallocated", "allocated", "excluded", "matched"],
      default: "unallocated",
      index: true,
    },

    // Why excluded (if status is "excluded"). Expanded set covers the
    // common things bookkeepers exclude from reconciliation:
    //   - duplicate: same transaction imported twice
    //   - opening_balance: not a real transaction (statement header line)
    //   - bank_charge: covered separately or already booked elsewhere
    //   - bank_interest: typically posted via journal, not allocated
    //   - reversal: cancellation pair to ignore
    //   - internal_transfer: between own accounts (handle via Transfer)
    //   - personal: owner-personal that shouldn't hit business books
    //   - manual: catch-all when none of the above fits
    //   - other: free-text via excludeNote
    excludeReason: {
      type: String,
      enum: [
        "duplicate",
        "opening_balance",
        "bank_charge",
        "bank_interest",
        "reversal",
        "internal_transfer",
        "personal",
        "manual",
        "other",
      ],
    },

    excludeNote: String,

    // ============================================
    // ALLOCATION DETAILS
    // ============================================
    allocationType: {
      type: String,
      enum: [
        "invoice_payment",    // Match to customer invoice
        "bill_payment",       // Match to vendor bill
        "expense",            // Direct expense
        "income",             // Direct income
        "transfer",           // Bank transfer
        "split",              // Split across multiple accounts
        "manual_journal",     // Manual journal entry
      ],
    },

    // For invoice_payment or bill_payment
    matchedDocument: {
      type: {
        type: String,
        enum: ["invoice", "bill"],
      },
      documentId: Schema.Types.ObjectId,
      documentNumber: String,
      partyId: Schema.Types.ObjectId,
      partyName: String,
    },

    // For expense, income, transfer, or split
    allocations: [
      {
        accountId: {
          type: Schema.Types.ObjectId,
          ref: "Account",
        },
        accountCode: String,
        accountName: String,
        amount: Number,
        description: String,
        // For tax
        taxAmount: Number,
        taxAccountId: Schema.Types.ObjectId,
      },
    ],

    // Party (customer/supplier) if applicable
    party: {
      type: {
        type: String,
        enum: ["customer", "supplier"],
      },
      id: Schema.Types.ObjectId,
      name: String,
    },

    // ============================================
    // RESULTING JOURNAL ENTRY
    // ============================================
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
    },

    // ============================================
    // MATCHING SUGGESTIONS (auto-generated)
    // ============================================
    suggestions: [
      {
        type: {
          type: String,
          enum: ["invoice", "bill"],
        },
        documentId: Schema.Types.ObjectId,
        documentNumber: String,
        partyName: String,
        amount: Number,
        confidence: Number, // 0-100
        matchReason: String, // "reference_match", "amount_match", "party_match"
      },
    ],

    // ============================================
    // AUDIT
    // ============================================
    allocatedBy: {
      id: String,
      name: String,
    },

    allocatedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
bankFeedLineSchema.index({ companyId: 1, status: 1, transactionDate: -1 });
bankFeedLineSchema.index({ statementId: 1, status: 1 });
bankFeedLineSchema.index({ companyId: 1, transactionDate: -1 });
bankFeedLineSchema.index({ description: "text", reference: "text" }); // Text search for matching
// Unique hash per company to prevent duplicate transaction imports
bankFeedLineSchema.index({ companyId: 1, lineHash: 1 }, { unique: true, sparse: true });

// ============================================
// VIRTUAL: Net amount
// ============================================
bankFeedLineSchema.virtual("netAmount").get(function () {
  return this.creditAmount - this.debitAmount;
});

bankFeedLineSchema.virtual("isDebit").get(function () {
  return this.debitAmount > 0;
});

bankFeedLineSchema.virtual("isCredit").get(function () {
  return this.creditAmount > 0;
});

// ============================================
// MODEL EXPORTS
// ============================================
const models = mongoose.models;

let BankStatement = models?.BankStatement;
let BankFeedLine = models?.BankFeedLine;

if (!BankStatement) {
  BankStatement = mongoose.model("BankStatement", bankStatementSchema);
}

if (!BankFeedLine) {
  BankFeedLine = mongoose.model("BankFeedLine", bankFeedLineSchema);
}

export { BankStatement, BankFeedLine };
export default BankStatement;

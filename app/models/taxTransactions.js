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
// TAX TRANSACTION SCHEMA
// ============================================
const taxTransactionSchema = new Schema(
  {
    // Transaction Identification
    transactionNumber: {
      type: String,
      required: [true, "Transaction number is required"],
      unique: true,
      index: true,
    },

    transactionDate: {
      type: Date,
      required: [true, "Transaction date is required"],
      index: true,
    },

    // Tax Type
    taxType: {
      type: String,
      required: [true, "Tax type is required"],
      enum: {
        values: ["vat_input", "vat_output", "wht", "other"],
        message: "{VALUE} is not a valid tax type",
      },
      index: true,
    },

    // Tax Details
    taxCode: {
      type: String,
      required: [true, "Tax code is required"],
      // e.g., "VAT-16", "WHT-5", "WHT-10"
      trim: true,
      uppercase: true,
    },

    taxRate: {
      type: Number,
      required: [true, "Tax rate is required"],
      min: [0, "Tax rate cannot be negative"],
      max: [100, "Tax rate cannot exceed 100%"],
    },

    // Amounts
    baseAmount: {
      type: Number,
      required: [true, "Base amount is required"],
      min: [0, "Base amount cannot be negative"],
      // The amount on which tax is calculated
    },

    taxAmount: {
      type: Number,
      required: [true, "Tax amount is required"],
      min: [0, "Tax amount cannot be negative"],
    },

    totalAmount: {
      type: Number,
      required: [true, "Total amount is required"],
      min: [0, "Total amount cannot be negative"],
      // baseAmount + taxAmount (for VAT Output)
      // baseAmount - taxAmount (for WHT)
      // baseAmount + taxAmount (for VAT Input)
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
    },

    // ============================================
    // PARTY INFORMATION
    // ============================================
    party: {
      type: {
        type: String,
        enum: ["customer", "supplier", "other"],
        required: [true, "Party type is required"],
      },
      id: {
        type: String,
        required: [true, "Party ID is required"],
      },
      name: {
        type: String,
        required: [true, "Party name is required"],
      },
      taxPin: {
        type: String,
        uppercase: true,
        trim: true,
      },
      email: String,
      phone: String,
    },

    // ============================================
    // SOURCE DOCUMENT
    // ============================================
    sourceDocument: {
      type: {
        type: String,
        enum: ["invoice", "bill", "journal_entry", "other"],
        required: [true, "Source document type is required"],
      },
      id: {
        type: Schema.Types.ObjectId,
        required: [true, "Source document ID is required"],
        refPath: "sourceDocument.type",
      },
      number: String,
      date: Date,
    },

    // ============================================
    // TAX AUTHORITY TRACKING
    // ============================================
    kraTracking: {
      // For Kenya Revenue Authority

      // Filing period
      filingPeriod: {
        type: String,
        // e.g., "2025-01" for January 2025
        index: true,
      },

      // Filed status
      filed: {
        type: Boolean,
        default: false,
        index: true,
      },

      filedAt: Date,

      filedBy: {
        name: String,
        id: String,
      },

      // Filing reference
      filingReference: String,

      // For WHT: Remittance status
      remitted: {
        type: Boolean,
        default: false,
        index: true,
      },

      remittedAt: Date,

      remittedBy: {
        name: String,
        id: String,
      },

      remittanceReference: String,

      // Certificate (for WHT)
      certificateIssued: {
        type: Boolean,
        default: false,
      },

      certificateNumber: String,

      certificateIssuedAt: Date,
    },

    // ============================================
    // RECONCILIATION
    // ============================================
    reconciliation: {
      reconciled: {
        type: Boolean,
        default: false,
        index: true,
      },

      reconciledAt: Date,

      reconciledBy: {
        name: String,
        id: String,
      },

      notes: String,
    },

    // ============================================
    // ACCOUNTING LINK
    // ============================================
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      index: true,
    },

    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: [true, "Account is required"],
      index: true,
    },

    accountCode: String,
    accountName: String,

    // ============================================
    // ADDITIONAL INFO
    // ============================================
    description: String,
    notes: String,

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
  }
);

// ============================================
// COMPOUND INDEXES
// ============================================
taxTransactionSchema.index({ transactionDate: -1, taxType: 1 });
taxTransactionSchema.index({ "party.id": 1, taxType: 1 });
taxTransactionSchema.index({ taxType: 1, "kraTracking.filed": 1 });
taxTransactionSchema.index({ taxType: 1, "kraTracking.remitted": 1 });
taxTransactionSchema.index({ "kraTracking.filingPeriod": 1, taxType: 1 });
taxTransactionSchema.index({
  "sourceDocument.type": 1,
  "sourceDocument.id": 1,
});

// ============================================
// VIRTUALS
// ============================================
taxTransactionSchema.virtual("isVATInput").get(function () {
  return this.taxType === "vat_input";
});

taxTransactionSchema.virtual("isVATOutput").get(function () {
  return this.taxType === "vat_output";
});

taxTransactionSchema.virtual("isWHT").get(function () {
  return this.taxType === "wht";
});

taxTransactionSchema.virtual("needsFiling").get(function () {
  return !this.kraTracking.filed;
});

taxTransactionSchema.virtual("needsRemittance").get(function () {
  return this.isWHT && !this.kraTracking.remitted;
});

taxTransactionSchema.virtual("needsCertificate").get(function () {
  return (
    this.isWHT &&
    this.kraTracking.remitted &&
    !this.kraTracking.certificateIssued
  );
});

// ============================================
// METHODS
// ============================================

/**
 * Mark as filed with KRA
 */
taxTransactionSchema.methods.markAsFiled = async function (
  filedBy,
  filingReference
) {
  const userInfo = formatUserForAudit(filedBy);

  this.kraTracking.filed = true;
  this.kraTracking.filedAt = new Date();
  this.kraTracking.filedBy = userInfo;
  this.kraTracking.filingReference = filingReference;
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

/**
 * Mark WHT as remitted to KRA
 */
taxTransactionSchema.methods.markAsRemitted = async function (
  remittedBy,
  remittanceReference
) {
  if (!this.isWHT) {
    throw new Error("Only WHT transactions can be marked as remitted");
  }

  const userInfo = formatUserForAudit(remittedBy);

  this.kraTracking.remitted = true;
  this.kraTracking.remittedAt = new Date();
  this.kraTracking.remittedBy = userInfo;
  this.kraTracking.remittanceReference = remittanceReference;
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

/**
 * Issue WHT certificate
 */
taxTransactionSchema.methods.issueCertificate = async function (
  issuedBy,
  certificateNumber
) {
  if (!this.isWHT) {
    throw new Error("Only WHT transactions can have certificates");
  }

  if (!this.kraTracking.remitted) {
    throw new Error("WHT must be remitted before issuing certificate");
  }

  if (this.kraTracking.certificateIssued) {
    throw new Error(
      `Certificate already issued: ${this.kraTracking.certificateNumber}`
    );
  }

  const userInfo = formatUserForAudit(issuedBy);

  this.kraTracking.certificateIssued = true;
  this.kraTracking.certificateNumber = certificateNumber;
  this.kraTracking.certificateIssuedAt = new Date();
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

/**
 * Reconcile transaction
 */
taxTransactionSchema.methods.reconcile = async function (reconciledBy, notes) {
  const userInfo = formatUserForAudit(reconciledBy);

  this.reconciliation.reconciled = true;
  this.reconciliation.reconciledAt = new Date();
  this.reconciliation.reconciledBy = userInfo;
  this.reconciliation.notes = notes || "";
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get transactions by type
 */
taxTransactionSchema.statics.getByType = function (
  taxType,
  startDate,
  endDate
) {
  const query = { taxType };

  if (startDate && endDate) {
    query.transactionDate = { $gte: startDate, $lte: endDate };
  }

  return this.find(query).sort({ transactionDate: -1 }).lean();
};

/**
 * Get unfiled transactions
 */
taxTransactionSchema.statics.getUnfiled = function (taxType = null) {
  const query = { "kraTracking.filed": false };

  if (taxType) {
    query.taxType = taxType;
  }

  return this.find(query).sort({ transactionDate: 1 }).lean();
};

/**
 * Get unremitted WHT
 */
taxTransactionSchema.statics.getUnremittedWHT = function () {
  return this.find({
    taxType: "wht",
    "kraTracking.remitted": false,
  })
    .sort({ transactionDate: 1 })
    .lean();
};

/**
 * Get VAT return for period
 */
taxTransactionSchema.statics.getVATReturn = async function (filingPeriod) {
  const [input, output] = await Promise.all([
    // VAT Input (purchases)
    this.aggregate([
      {
        $match: {
          taxType: "vat_input",
          "kraTracking.filingPeriod": filingPeriod,
        },
      },
      {
        $group: {
          _id: null,
          totalBase: { $sum: "$baseAmount" },
          totalTax: { $sum: "$taxAmount" },
          count: { $sum: 1 },
        },
      },
    ]),
    // VAT Output (sales)
    this.aggregate([
      {
        $match: {
          taxType: "vat_output",
          "kraTracking.filingPeriod": filingPeriod,
        },
      },
      {
        $group: {
          _id: null,
          totalBase: { $sum: "$baseAmount" },
          totalTax: { $sum: "$taxAmount" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const vatInput = input[0] || { totalBase: 0, totalTax: 0, count: 0 };
  const vatOutput = output[0] || { totalBase: 0, totalTax: 0, count: 0 };
  const vatPayable = vatOutput.totalTax - vatInput.totalTax;

  return {
    period: filingPeriod,
    input: vatInput,
    output: vatOutput,
    vatPayable: vatPayable,
    vatRefundable: vatPayable < 0 ? Math.abs(vatPayable) : 0,
  };
};

/**
 * Get WHT report by rate
 */
taxTransactionSchema.statics.getWHTReportByRate = async function (
  startDate,
  endDate
) {
  return this.aggregate([
    {
      $match: {
        taxType: "wht",
        transactionDate: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: {
          taxCode: "$taxCode",
          taxRate: "$taxRate",
        },
        totalBase: { $sum: "$baseAmount" },
        totalTax: { $sum: "$taxAmount" },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        taxCode: "$_id.taxCode",
        taxRate: "$_id.taxRate",
        totalBase: 1,
        totalTax: 1,
        count: 1,
      },
    },
    {
      $sort: { taxRate: 1 },
    },
  ]);
};

/**
 * Get WHT report by party
 */
taxTransactionSchema.statics.getWHTReportByParty = async function (
  startDate,
  endDate
) {
  return this.aggregate([
    {
      $match: {
        taxType: "wht",
        transactionDate: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: {
          partyId: "$party.id",
          partyName: "$party.name",
          taxPin: "$party.taxPin",
        },
        totalBase: { $sum: "$baseAmount" },
        totalTax: { $sum: "$taxAmount" },
        transactions: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        partyId: "$_id.partyId",
        partyName: "$_id.partyName",
        taxPin: "$_id.taxPin",
        totalBase: 1,
        totalTax: 1,
        transactions: 1,
      },
    },
    {
      $sort: { totalTax: -1 },
    },
  ]);
};

/**
 * Create from invoice (VAT Output)
 */
taxTransactionSchema.statics.createFromInvoice = async function (
  invoice,
  createdBy
) {
  if (invoice.taxAmount <= 0) {
    return null; // No tax to record
  }

  const userInfo = formatUserForAudit(createdBy);

  // Determine filing period
  const invoiceDate = new Date(invoice.invoiceDate);
  const filingPeriod = `${invoiceDate.getFullYear()}-${String(
    invoiceDate.getMonth() + 1
  ).padStart(2, "0")}`;

  // Get VAT Output account
  const Account = mongoose.model("Account");
  const vatAccount = await Account.findOne({ systemAccount: "vat_output" });

  if (!vatAccount) {
    throw new Error("VAT Output account not configured");
  }

  const taxTransaction = await this.create({
    transactionNumber: `VAT-OUT-${invoice.invoiceNumber}`,
    transactionDate: invoice.invoiceDate,
    taxType: "vat_output",
    taxCode: "VAT-16",
    taxRate: 16,
    baseAmount: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    totalAmount: invoice.total,
    currency: invoice.currency || "KES",
    party: {
      type: "customer",
      id: invoice.customer.id,
      name: invoice.customer.name,
      taxPin: invoice.customer.taxPin,
      email: invoice.customer.email,
      phone: invoice.customer.phone,
    },
    sourceDocument: {
      type: "invoice",
      id: invoice._id,
      number: invoice.invoiceNumber,
      date: invoice.invoiceDate,
    },
    kraTracking: {
      filingPeriod,
      filed: false,
    },
    journalEntryId: invoice.accounting?.revenueJournalEntryId,
    accountId: vatAccount._id,
    accountCode: vatAccount.accountCode,
    accountName: vatAccount.accountName,
    description: `VAT Output on sale to ${invoice.customer.name}`,
    createdBy: userInfo,
  });

  return taxTransaction;
};

/**
 * Create from bill (VAT Input + WHT)
 */
taxTransactionSchema.statics.createFromBill = async function (bill, createdBy) {
  const transactions = [];
  const userInfo = formatUserForAudit(createdBy);

  // Determine filing period
  const billDate = new Date(bill.billDate);
  const filingPeriod = `${billDate.getFullYear()}-${String(
    billDate.getMonth() + 1
  ).padStart(2, "0")}`;

  const Account = mongoose.model("Account");

  // VAT Input
  if (bill.taxAmount > 0) {
    const vatAccount = await Account.findOne({ systemAccount: "vat_input" });

    if (!vatAccount) {
      throw new Error("VAT Input account not configured");
    }

    const vatTransaction = await this.create({
      transactionNumber: `VAT-IN-${bill.billNumber}`,
      transactionDate: bill.billDate,
      taxType: "vat_input",
      taxCode: "VAT-16",
      taxRate: 16,
      baseAmount: bill.subtotal,
      taxAmount: bill.taxAmount,
      totalAmount: bill.total,
      currency: bill.currency || "KES",
      party: {
        type: "supplier",
        id: bill.supplier.id,
        name: bill.supplier.name,
        taxPin: bill.supplier.taxPin,
        email: bill.supplier.email,
        phone: bill.supplier.phone,
      },
      sourceDocument: {
        type: "bill",
        id: bill._id,
        number: bill.billNumber,
        date: bill.billDate,
      },
      kraTracking: {
        filingPeriod,
        filed: false,
      },
      journalEntryId: bill.journalEntryId,
      accountId: vatAccount._id,
      accountCode: vatAccount.accountCode,
      accountName: vatAccount.accountName,
      description: `VAT Input on purchase from ${bill.supplier.name}`,
      createdBy: userInfo,
    });

    transactions.push(vatTransaction);
  }

  // WHT
  if (bill.withholdingTaxAmount > 0) {
    const whtAccount = await Account.findOne({ systemAccount: "wht_payable" });

    if (!whtAccount) {
      throw new Error("WHT Payable account not configured");
    }

    // Determine WHT rate from bill lines
    const whtLine = bill.lines.find(
      (line) => line.whtApplicable && line.whtRate > 0
    );
    const whtRate = whtLine?.whtRate || 5;

    const whtTransaction = await this.create({
      transactionNumber: `WHT-${bill.billNumber}`,
      transactionDate: bill.billDate,
      taxType: "wht",
      taxCode: `WHT-${whtRate}`,
      taxRate: whtRate,
      baseAmount: bill.subtotal,
      taxAmount: bill.withholdingTaxAmount,
      totalAmount: bill.netPayable,
      currency: bill.currency || "KES",
      party: {
        type: "supplier",
        id: bill.supplier.id,
        name: bill.supplier.name,
        taxPin: bill.supplier.taxPin,
        email: bill.supplier.email,
        phone: bill.supplier.phone,
      },
      sourceDocument: {
        type: "bill",
        id: bill._id,
        number: bill.billNumber,
        date: bill.billDate,
      },
      kraTracking: {
        filingPeriod,
        filed: false,
        remitted: false,
      },
      journalEntryId: bill.journalEntryId,
      accountId: whtAccount._id,
      accountCode: whtAccount.accountCode,
      accountName: whtAccount.accountName,
      description: `WHT ${whtRate}% on payment to ${bill.supplier.name}`,
      createdBy: userInfo,
    });

    transactions.push(whtTransaction);
  }

  return transactions;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let TaxTransaction = models?.TaxTransaction;

if (!TaxTransaction) {
  TaxTransaction = mongoose.model("TaxTransaction", taxTransactionSchema);
}

export default TaxTransaction;

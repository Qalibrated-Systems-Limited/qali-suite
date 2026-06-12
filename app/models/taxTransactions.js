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
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Transaction Identification
    transactionNumber: {
      type: String,
      required: [true, "Transaction number is required"],
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
        values: [
          // VAT Transactions
          "vat_input", // VAT on purchases (claimable)
          "vat_output", // VAT on sales (payable)
          // Withholding Taxes
          "wht", // Withholding Tax on supplier payments
          "wht_received", // WHT certificate received (from customer)
          // Payroll Taxes
          "paye", // Pay As You Earn (employee income tax)
          "nssf", // National Social Security Fund
          "shif", // Social Health Insurance Fund (replaced NHIF Oct 2024)
          "nhif", // Legacy — kept in enum so historical records still validate
          "housing_levy", // Housing Levy (1.5%)
          // Other Taxes
          "excise_duty", // Excise duty on specific goods/services
          "advance_tax", // Advance tax on certain income
          "dst", // Digital Services Tax (1.5%)
          "turnover_tax", // Turnover Tax (for small businesses)
          "cgt", // Capital Gains Tax (on asset disposal)
          "other", // Other miscellaneous taxes
        ],
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
  },
);

// ============================================
// COMPOUND INDEXES
// ============================================
// Unique transaction number per company
taxTransactionSchema.index(
  { companyId: 1, transactionNumber: 1 },
  { unique: true },
);
// Query indexes - all prefixed with companyId for tenant isolation
taxTransactionSchema.index({ companyId: 1, transactionDate: -1, taxType: 1 });
taxTransactionSchema.index({ companyId: 1, "party.id": 1, taxType: 1 });
taxTransactionSchema.index({
  companyId: 1,
  taxType: 1,
  "kraTracking.filed": 1,
});
taxTransactionSchema.index({
  companyId: 1,
  taxType: 1,
  "kraTracking.remitted": 1,
});
taxTransactionSchema.index({
  companyId: 1,
  "kraTracking.filingPeriod": 1,
  taxType: 1,
});
taxTransactionSchema.index({
  companyId: 1,
  "sourceDocument.type": 1,
  "sourceDocument.id": 1,
});

// ============================================
// VIRTUALS
// ============================================
// ============================================
// VIRTUALS - Tax Type Checks
// ============================================
taxTransactionSchema.virtual("isVATInput").get(function () {
  return this.taxType === "vat_input";
});

taxTransactionSchema.virtual("isVATOutput").get(function () {
  return this.taxType === "vat_output";
});

taxTransactionSchema.virtual("isWHT").get(function () {
  return this.taxType === "wht" || this.taxType === "wht_received";
});

taxTransactionSchema.virtual("isPayrollTax").get(function () {
  return ["paye", "nssf", "shif", "nhif", "housing_levy"].includes(this.taxType);
});

taxTransactionSchema.virtual("isVAT").get(function () {
  return this.taxType === "vat_input" || this.taxType === "vat_output";
});

// ============================================
// VIRTUALS - Status Checks
// ============================================
taxTransactionSchema.virtual("needsFiling").get(function () {
  return !this.kraTracking.filed;
});

taxTransactionSchema.virtual("needsRemittance").get(function () {
  // WHT and payroll taxes need remittance to KRA
  const remittableTaxes = ["wht", "paye", "nssf", "shif", "nhif", "housing_levy"];
  return remittableTaxes.includes(this.taxType) && !this.kraTracking.remitted;
});

taxTransactionSchema.virtual("needsCertificate").get(function () {
  return (
    this.taxType === "wht" &&
    this.kraTracking.remitted &&
    !this.kraTracking.certificateIssued
  );
});

// Filing deadline based on tax type (Kenya rules)
taxTransactionSchema.virtual("filingDeadline").get(function () {
  if (!this.kraTracking.filingPeriod) return null;

  const [year, month] = this.kraTracking.filingPeriod.split("-").map(Number);
  const deadlines = {
    vat_input: 20, // VAT: 20th of following month
    vat_output: 20, // VAT: 20th of following month
    wht: 20, // WHT: 20th of following month
    paye: 9, // PAYE: 9th of following month
    nssf: 15, // NSSF: 15th of following month
    shif: 9, // SHIF: 9th of following month (replaced NHIF Oct 2024)
    nhif: 9, // Legacy alias — kept for historical records
    housing_levy: 9, // Housing Levy: 9th of following month
  };

  const deadlineDay = deadlines[this.taxType] || 20;
  // Get following month
  const deadlineMonth = month === 12 ? 1 : month + 1;
  const deadlineYear = month === 12 ? year + 1 : year;

  return new Date(deadlineYear, deadlineMonth - 1, deadlineDay);
});

// ============================================
// METHODS
// ============================================

/**
 * Mark as filed with KRA
 */
taxTransactionSchema.methods.markAsFiled = async function (
  filedBy,
  filingReference,
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
  remittanceReference,
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
  certificateNumber,
) {
  if (!this.isWHT) {
    throw new Error("Only WHT transactions can have certificates");
  }

  if (!this.kraTracking.remitted) {
    throw new Error("WHT must be remitted before issuing certificate");
  }

  if (this.kraTracking.certificateIssued) {
    throw new Error(
      `Certificate already issued: ${this.kraTracking.certificateNumber}`,
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
// STATIC METHODS (All tenant-scoped)
// ============================================

/**
 * Get transactions by type (tenant-scoped)
 * @param {ObjectId} companyId - Required company ID for tenant isolation
 * @param {String} taxType - Tax type to filter by
 * @param {Date} startDate - Optional start date
 * @param {Date} endDate - Optional end date
 */
taxTransactionSchema.statics.getByType = function (
  companyId,
  taxType,
  startDate,
  endDate,
) {
  if (!companyId) {
    throw new Error("companyId is required for tenant isolation");
  }

  const query = { companyId, taxType };

  if (startDate && endDate) {
    query.transactionDate = { $gte: startDate, $lte: endDate };
  }

  return this.find(query).sort({ transactionDate: -1 }).lean();
};

/**
 * Get unfiled transactions (tenant-scoped)
 * @param {ObjectId} companyId - Required company ID for tenant isolation
 * @param {String} taxType - Optional tax type filter
 */
taxTransactionSchema.statics.getUnfiled = function (companyId, taxType = null) {
  if (!companyId) {
    throw new Error("companyId is required for tenant isolation");
  }

  const query = { companyId, "kraTracking.filed": false };

  if (taxType) {
    query.taxType = taxType;
  }

  return this.find(query).sort({ transactionDate: 1 }).lean();
};

/**
 * Get unremitted WHT (tenant-scoped)
 * @param {ObjectId} companyId - Required company ID for tenant isolation
 */
taxTransactionSchema.statics.getUnremittedWHT = function (companyId) {
  if (!companyId) {
    throw new Error("companyId is required for tenant isolation");
  }

  return this.find({
    companyId,
    taxType: "wht",
    "kraTracking.remitted": false,
  })
    .sort({ transactionDate: 1 })
    .lean();
};

/**
 * Get VAT return for period (tenant-scoped)
 * @param {ObjectId} companyId - Required company ID for tenant isolation
 * @param {String} filingPeriod - Filing period in YYYY-MM format
 */
taxTransactionSchema.statics.getVATReturn = async function (
  companyId,
  filingPeriod,
) {
  if (!companyId) {
    throw new Error("companyId is required for tenant isolation");
  }

  const companyObjectId = new mongoose.Types.ObjectId(companyId);

  const [input, output] = await Promise.all([
    // VAT Input (purchases)
    this.aggregate([
      {
        $match: {
          companyId: companyObjectId,
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
          companyId: companyObjectId,
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
 * Get WHT report by rate (tenant-scoped)
 * @param {ObjectId} companyId - Required company ID for tenant isolation
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 */
taxTransactionSchema.statics.getWHTReportByRate = async function (
  companyId,
  startDate,
  endDate,
) {
  if (!companyId) {
    throw new Error("companyId is required for tenant isolation");
  }

  const companyObjectId = new mongoose.Types.ObjectId(companyId);

  return this.aggregate([
    {
      $match: {
        companyId: companyObjectId,
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
 * Get WHT report by party (tenant-scoped)
 * @param {ObjectId} companyId - Required company ID for tenant isolation
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 */
taxTransactionSchema.statics.getWHTReportByParty = async function (
  companyId,
  startDate,
  endDate,
) {
  if (!companyId) {
    throw new Error("companyId is required for tenant isolation");
  }

  const companyObjectId = new mongoose.Types.ObjectId(companyId);

  return this.aggregate([
    {
      $match: {
        companyId: companyObjectId,
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
  createdBy,
  session = null,
) {
  // Validate invoice object
  if (!invoice || !invoice._id) {
    throw new Error("Invalid invoice: missing invoice or invoice._id");
  }

  if (!invoice.customer || !invoice.customer.id) {
    throw new Error("Invalid invoice: missing customer information");
  }

  if (invoice.taxAmount <= 0) {
    return null; // No tax to record
  }

  const userInfo = formatUserForAudit(createdBy);

  // Determine filing period
  const invoiceDate = new Date(invoice.invoiceDate);
  const filingPeriod = `${invoiceDate.getFullYear()}-${String(
    invoiceDate.getMonth() + 1,
  ).padStart(2, "0")}`;

  // Get VAT Output account (tenant-scoped)
  const Account = mongoose.model("Account");
  const vatAccount = await Account.findOne({
    companyId: invoice.companyId,
    systemAccount: "vat_output",
  });

  if (!vatAccount) {
    throw new Error("VAT Output account not configured for this company");
  }

  const [taxTransaction] = await this.create([{
    companyId: invoice.companyId, // Tenant scoping
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
  }], session ? { session } : {});

  return taxTransaction;
};

/**
 * Create from bill (VAT Input + WHT)
 *
 * Bill schema uses:
 * - amounts.vat, amounts.subtotal, amounts.total, amounts.wht, amounts.netPayable
 * - supplier.partyId (not supplier.id)
 * - accounting.journalEntryId
 * - whtApplicable and whtRate at bill level
 */
taxTransactionSchema.statics.createFromBill = async function (bill, createdBy) {
  const transactions = [];
  const userInfo = formatUserForAudit(createdBy);

  // Validate bill object
  if (!bill || !bill._id) {
    throw new Error("Invalid bill: missing bill or bill._id");
  }

  if (!bill.supplier || !bill.supplier.partyId) {
    throw new Error("Invalid bill: missing supplier information");
  }

  // Determine filing period from bill date
  const billDate = new Date(bill.billDate);
  const filingPeriod = `${billDate.getFullYear()}-${String(
    billDate.getMonth() + 1,
  ).padStart(2, "0")}`;

  const Account = mongoose.model("Account");

  // ==========================================
  // VAT Input (from purchases)
  // ==========================================
  const vatAmount = bill.amounts?.vat || 0;

  if (vatAmount > 0) {
    const vatAccount = await Account.findOne({
      companyId: bill.companyId,
      systemAccount: "vat_input",
    });

    if (!vatAccount) {
      throw new Error("VAT Input account not configured for this company");
    }

    // Calculate effective VAT rate from amounts (or default to 16%)
    const subtotal = bill.amounts?.subtotal || 0;
    const effectiveVatRate =
      subtotal > 0 ? Math.round((vatAmount / subtotal) * 100) : 16;

    const vatTransaction = await this.create({
      companyId: bill.companyId,
      transactionNumber: `VAT-IN-${bill.billNumber}`,
      transactionDate: bill.billDate,
      taxType: "vat_input",
      taxCode: `VAT-${effectiveVatRate}`,
      taxRate: effectiveVatRate,
      baseAmount: subtotal,
      taxAmount: vatAmount,
      totalAmount: bill.amounts?.total || subtotal + vatAmount,
      currency: bill.currency || "KES",
      party: {
        type: "supplier",
        id: bill.supplier.partyId.toString(),
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
      journalEntryId: bill.accounting?.journalEntryId,
      accountId: vatAccount._id,
      accountCode: vatAccount.accountCode,
      accountName: vatAccount.accountName,
      description: `VAT Input on purchase from ${bill.supplier.name}`,
      createdBy: userInfo,
    });

    transactions.push(vatTransaction);
  }

  // ==========================================
  // WHT (Withholding Tax on supplier payments)
  // ==========================================
  const whtAmount = bill.amounts?.wht || 0;

  if (whtAmount > 0 && bill.whtApplicable) {
    const whtAccount = await Account.findOne({
      companyId: bill.companyId,
      systemAccount: "wht_payable",
    });

    if (!whtAccount) {
      throw new Error("WHT Payable account not configured for this company");
    }

    // Get WHT rate from bill (defaults to 5% if not specified)
    const whtRate = bill.whtRate || 5;

    const whtTransaction = await this.create({
      companyId: bill.companyId,
      transactionNumber: `WHT-${bill.billNumber}`,
      transactionDate: bill.billDate,
      taxType: "wht",
      taxCode: `WHT-${whtRate}`,
      taxRate: whtRate,
      baseAmount: bill.amounts?.subtotal || 0,
      taxAmount: whtAmount,
      totalAmount: bill.amounts?.netPayable || 0,
      currency: bill.currency || "KES",
      party: {
        type: "supplier",
        id: bill.supplier.partyId.toString(),
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
      journalEntryId: bill.accounting?.journalEntryId,
      accountId: whtAccount._id,
      accountCode: whtAccount.accountCode,
      accountName: whtAccount.accountName,
      description: `WHT ${whtRate}% withheld on payment to ${bill.supplier.name}`,
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

import mongoose from "mongoose";
import { ErpCounter } from "./erp-counter";

// Import models needed for the approve method
// These imports ensure models are registered before mongoose.model() is called
import "@/app/models/fiscalPeriod";
import "@/app/models/JournalEntry";
import "@/app/models/taxTransactions";
import "@/app/models/account";
import "@/app/models/product";
import "@/app/models/stockmovement";

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
// BILL SCHEMA - ACCOUNTS PAYABLE
// ============================================
// Design Principles:
// 1. Single Responsibility - Bill tracks what we owe, not tax compliance
// 2. Strategic Denormalization - Cache read-heavy data, reference write-heavy
// 3. Bounded Arrays - Max 50 lines per bill (reasonable business limit)
// 4. Immutable Snapshots - Supplier info frozen at bill creation
// 5. Lean Core - Tax tracking in TaxTransaction, Payments in Payment
// ============================================

const billLineSchema = new Schema(
  {
    // Line Identification
    lineNumber: {
      type: Number,
      required: true,
      min: 1,
    },

    // Product Reference (optional - for inventory items)
    product: {
      id: { type: Schema.Types.ObjectId, ref: "Product" },
      sku: { type: String, uppercase: true, trim: true },
      name: String,
    },

    // Line Details
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: 500,
    },

    // Account (required - where to post expense/asset)
    account: {
      id: {
        type: Schema.Types.ObjectId,
        ref: "Account",
        required: [true, "Account is required"],
      },
      code: String, // Cached for display
      name: String, // Cached for display
      type: {
        type: String,
        enum: ["expense", "asset"],
        required: true,
      },
    },

    // Optional link to a fixed asset (for maintenance/fuel/repair cost tracking).
    // Snapshots name/number at save time so display survives asset rename/delete.
    asset: {
      id: { type: Schema.Types.ObjectId, ref: "Asset", default: null },
      assetNumber: { type: String, default: null },
      name: { type: String, default: null },
    },

    // Set when this asset-type line has been capitalized into the Fixed Asset
    // register. Prevents double-capitalization and lets the bill UI link out.
    capitalizedAssetId: {
      type: Schema.Types.ObjectId,
      ref: "Asset",
      default: null,
    },

    // Quantities & Pricing
    quantity: {
      type: Number,
      required: true,
      min: [0.001, "Quantity must be positive"],
    },

    unit: {
      type: String,
      default: "pcs",
      trim: true,
    },

    unitPrice: {
      type: Number,
      required: true,
      min: [0, "Unit price cannot be negative"],
    },

    // Calculated: quantity × unitPrice
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // VAT on this line
    vat: {
      rate: { type: Number, default: 0, min: 0, max: 100 },
      amount: { type: Number, default: 0, min: 0 },
    },

    // Line total: amount + vat.amount
    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    // PO Reference (if from Purchase Order)
    poReference: {
      poId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder" },
      poNumber: String,
      poLineIndex: Number,
    },

    // Weighbridge Receipt Reference
    // When set: bill posting debits GR/IR (to clear it) instead of Inventory
    // because WB receipt already did DR Inventory / CR GR/IR.
    // Represents the GR/IR matching step: DR GR/IR, CR Accounts Payable.
    weighbridgeRef: {
      ticketId:     { type: Schema.Types.ObjectId, ref: "WeighbridgeTicket", default: null },
      ticketNumber: { type: String, default: null },
    },
  },
  { _id: true },
);

// ============================================
// MAIN BILL SCHEMA
// ============================================
const billSchema = new Schema(
  {
    // ==========================================
    // COMPANY (TENANT)
    // ==========================================
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // ==========================================
    // IDENTIFICATION
    // ==========================================
    billNumber: {
      type: String,
      required: [true, "Bill number is required"],
      uppercase: true,
      trim: true,
      index: true,
    },

    // Supplier's invoice number (for reconciliation)
    supplierInvoiceNumber: {
      type: String,
      trim: true,
      index: true,
    },

    // ==========================================
    // DATES
    // ==========================================
    billDate: {
      type: Date,
      required: [true, "Bill date is required"],
      index: true,
    },

    dueDate: {
      type: Date,
      required: [true, "Due date is required"],
      index: true,
    },

    // Fiscal period for accounting (YYYY-MM format)
    fiscalPeriod: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}$/, "Fiscal period must be YYYY-MM format"],
      index: true,
    },

    // ==========================================
    // PROJECT (optional)
    // ==========================================
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

    // ==========================================
    // SUPPLIER (Snapshot - immutable after creation)
    // ==========================================
    supplier: {
      partyId: {
        type: Schema.Types.ObjectId,
        ref: "Party",
        required: [true, "Supplier is required"],
        index: true,
      },
      // Cached at bill creation time (won't change if supplier updates)
      name: { type: String, required: true, trim: true },
      taxPin: { type: String, uppercase: true, trim: true },
      email: { type: String, lowercase: true, trim: true },
      phone: { type: String, trim: true },
      address: String,
    },

    // WHT Settings (from supplier at time of bill)
    whtApplicable: {
      type: Boolean,
      default: false,
    },

    whtRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 30,
    },

    // ==========================================
    // PURCHASE ORDER REFERENCE (optional)
    // ==========================================
    purchaseOrder: {
      poId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder" },
      poNumber: String,
    },

    // ==========================================
    // LINE ITEMS (Bounded: max 50 lines)
    // ==========================================
    lines: {
      type: [billLineSchema],
      validate: [
        {
          validator: function (lines) {
            return lines && lines.length > 0;
          },
          message: "Bill must have at least one line",
        },
        {
          validator: function (lines) {
            return lines.length <= 50;
          },
          message: "Bill cannot have more than 50 lines",
        },
      ],
    },

    // ==========================================
    // AMOUNTS (All calculated, stored for query efficiency)
    // ==========================================
    amounts: {
      // Sum of line amounts (before VAT)
      subtotal: {
        type: Number,
        required: true,
        min: 0,
      },

      // Sum of line VAT amounts
      vat: {
        type: Number,
        default: 0,
        min: 0,
      },

      // Gross total: subtotal + vat
      total: {
        type: Number,
        required: true,
        min: 0,
      },

      // WHT: subtotal × whtRate (if applicable)
      wht: {
        type: Number,
        default: 0,
        min: 0,
      },

      // Net payable: total - wht
      netPayable: {
        type: Number,
        required: true,
        min: 0,
      },

      // Payment tracking
      paid: {
        type: Number,
        default: 0,
        min: 0,
      },

      // Balance: netPayable - paid
      balance: {
        type: Number,
        default: function () {
          return this.amounts?.netPayable || 0;
        },
      },
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
      enum: ["KES", "USD", "EUR", "GBP"],
    },

    // ==========================================
    // STATUS & WORKFLOW
    // ==========================================
    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "rejected", "cancelled"],
      default: "draft",
      index: true,
    },

    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid"],
      default: "unpaid",
      index: true,
    },

    // ==========================================
    // WORKFLOW TIMESTAMPS
    // ==========================================
    submittedAt: Date,
    submittedBy: { name: String, id: String },

    approvedAt: Date,
    approvedBy: { name: String, id: String },

    rejectedAt: Date,
    rejectedBy: { name: String, id: String },
    rejectionReason: String,

    cancelledAt: Date,
    cancelledBy: { name: String, id: String },
    cancellationReason: String,

    // ==========================================
    // ACCOUNTING LINKS (References, not embedded)
    // ==========================================
    accounting: {
      journalEntryId: {
        type: Schema.Types.ObjectId,
        ref: "JournalEntry",
        index: true,
      },
      postedAt: Date,
      postedBy: { name: String, id: String },
      // True when bill approval physically moved inventory (legacy mode
      // OR bill in strict mode with no inventory lines). False when bill
      // posted to GR/IR clearing — physical receipt happens on GRN
      // acceptance. Drives the GRN action's source-aware branching.
      inventoryMoved: { type: Boolean, default: true },
      // True when JE used GR/IR clearing instead of Inventory account.
      // Set in strict mode; cleared by the GRN-accept JE (DR Inventory /
      // CR GR/IR) when the GRN is fully signed off.
      usedGRNI: { type: Boolean, default: false },
    },

    // Tax transactions created (reference only - details in TaxTransaction)
    taxTransactions: [
      {
        type: Schema.Types.ObjectId,
        ref: "TaxTransaction",
      },
    ],

    // ==========================================
    // PAYMENT HISTORY (Embedded - bounded, always read together)
    // Typically 1-2 payments, max ~20
    // ==========================================
    payments: {
      type: [
        {
          paymentId: {
            type: Schema.Types.ObjectId,
            ref: "Payment",
            required: true,
          },
          paymentNumber: { type: String, required: true },
          amount: { type: Number, required: true, min: 0 },
          method: {
            type: String,
            enum: ["cash", "mpesa", "bank_transfer", "cheque", "card"],
          },
          reference: String, // M-Pesa code, cheque number, etc.
          paidAt: { type: Date, required: true },
          recordedBy: { name: String, id: String },
        },
      ],
      validate: {
        validator: function (v) {
          return v.length <= 20;
        },
        message: "Cannot have more than 20 payments per bill",
      },
    },

    // ==========================================
    // TITLE & NOTES
    // ==========================================
    title: {
      type: String,
      maxlength: 200,
    },

    reference: {
      type: String,
      trim: true,
    },

    description: {
      type: String,
      maxlength: 1000,
    },

    internalNotes: {
      type: String,
      maxlength: 2000,
    },

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
  },
);

// ============================================
// INDEXES
// ============================================
// Unique bill number per company
billSchema.index({ companyId: 1, billNumber: 1 }, { unique: true });
// Query indexes
billSchema.index({ companyId: 1, billDate: -1, status: 1 });
billSchema.index({ companyId: 1, dueDate: 1, paymentStatus: 1 });
billSchema.index({ companyId: 1, "supplier.partyId": 1, status: 1 });
billSchema.index({ companyId: 1, fiscalPeriod: 1, status: 1 });
billSchema.index({ companyId: 1, status: 1, paymentStatus: 1 });
billSchema.index(
  { companyId: 1, "lines.asset.id": 1, billDate: -1 },
  { sparse: true }
);

// ============================================
// VIRTUALS
// ============================================
billSchema.virtual("isOverdue").get(function () {
  if (this.paymentStatus === "paid") return false;
  if (this.status !== "approved") return false;
  return new Date() > this.dueDate;
});

billSchema.virtual("daysOverdue").get(function () {
  if (!this.isOverdue) return 0;
  return Math.floor((new Date() - this.dueDate) / (1000 * 60 * 60 * 24));
});

billSchema.virtual("daysUntilDue").get(function () {
  if (this.paymentStatus === "paid") return null;
  const diff = this.dueDate - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

billSchema.virtual("canEdit").get(function () {
  return ["draft", "rejected"].includes(this.status);
});

billSchema.virtual("canSubmit").get(function () {
  return this.status === "draft";
});

billSchema.virtual("canApprove").get(function () {
  return this.status === "submitted";
});

billSchema.virtual("canPay").get(function () {
  return this.status === "approved" && this.paymentStatus !== "paid";
});

billSchema.virtual("canCancel").get(function () {
  // Can't cancel if any payments made
  if (this.amounts.paid > 0) return false;
  return ["draft", "submitted", "approved"].includes(this.status);
});

billSchema.virtual("lineCount").get(function () {
  return this.lines?.length || 0;
});

// ============================================
// PRE-SAVE: Calculate amounts
// ============================================
billSchema.pre("save", function (next) {
  // Calculate line totals
  let subtotal = 0;
  let totalVat = 0;

  this.lines.forEach((line, index) => {
    line.lineNumber = index + 1;
    line.amount = Math.round(line.quantity * line.unitPrice * 100) / 100;
    line.vat.amount =
      Math.round(line.amount * (line.vat.rate / 100) * 100) / 100;
    line.lineTotal = line.amount + line.vat.amount;

    subtotal += line.amount;
    totalVat += line.vat.amount;
  });

  // Set amounts
  this.amounts.subtotal = Math.round(subtotal * 100) / 100;
  this.amounts.vat = Math.round(totalVat * 100) / 100;
  this.amounts.total = this.amounts.subtotal + this.amounts.vat;

  // Calculate WHT if applicable
  if (this.whtApplicable && this.whtRate > 0) {
    this.amounts.wht =
      Math.round(this.amounts.subtotal * (this.whtRate / 100) * 100) / 100;
  } else {
    this.amounts.wht = 0;
  }

  // Net payable
  this.amounts.netPayable = this.amounts.total - this.amounts.wht;
  this.amounts.balance = this.amounts.netPayable - this.amounts.paid;

  // Set fiscal period from bill date if not set
  if (!this.fiscalPeriod && this.billDate) {
    const d = new Date(this.billDate);
    this.fiscalPeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0",
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
// METHOD: Submit for approval
// ============================================
billSchema.methods.submit = async function (user) {
  if (!this.canSubmit) {
    throw new Error(`Cannot submit bill in status: ${this.status}`);
  }

  // Validate lines
  if (!this.lines || this.lines.length === 0) {
    throw new Error("Bill must have at least one line item");
  }

  const userInfo = formatUser(user);

  this.status = "submitted";
  this.submittedAt = new Date();
  this.submittedBy = userInfo;
  this.lastModifiedBy = userInfo;

  await this.save();
  return this;
};

// ============================================
// METHOD: Approve (creates JE & Tax Transactions)
// ============================================
billSchema.methods.approve = async function (user) {
  if (!this.canApprove) {
    throw new Error(`Cannot approve bill in status: ${this.status}`);
  }

  const FiscalPeriod = mongoose.model("FiscalPeriod");
  const JournalEntry = mongoose.model("JournalEntry");
  const TaxTransaction = mongoose.model("TaxTransaction");
  const Account = mongoose.model("Account");
  const Product = mongoose.model("Product");
  const StockMovement = mongoose.model("StockMovement");
  const Company = mongoose.model("Company");

  const userInfo = formatUser(user);

  // Industry-standard three-way match toggle. When ON, this bill's
  // approval credits GR/IR clearing instead of Inventory, and we skip
  // the stock movement loop — inventory is admitted only when a Goods
  // Receipt Note is accepted (SOP §10.1).
  const company = await Company.findById(this.companyId)
    .select("settings.requireGRN")
    .lean();
  const requireGRN = !!company?.settings?.requireGRN;

  // ==========================================
  // 1. Find or Create Fiscal Period (auto-create on-the-fly like QuickBooks/Xero)
  // ==========================================
  const periodFilter = {
    periodCode: this.fiscalPeriod, // periodCode is "YYYY-MM" format
  };
  if (this.companyId) {
    periodFilter.companyId = this.companyId;
  }

  let fiscalPeriod = await FiscalPeriod.findOne(periodFilter);

  if (!fiscalPeriod) {
    // Auto-create the fiscal period from bill's fiscalPeriod (YYYY-MM)
    const [year, month] = this.fiscalPeriod.split("-").map(Number);

    try {
      fiscalPeriod = await FiscalPeriod.createMonthPeriod(
        year,
        month,
        userInfo,
        this.companyId,
      );
    } catch (createError) {
      // Handle race condition - period may have been created by another request
      fiscalPeriod = await FiscalPeriod.findOne(periodFilter);
      if (!fiscalPeriod) {
        throw new Error(
          `Failed to create fiscal period: ${createError.message}`,
        );
      }
    }
  }

  if (fiscalPeriod.status === "closed") {
    throw new Error(`Fiscal period ${this.fiscalPeriod} is closed`);
  }

  if (fiscalPeriod.status === "locked") {
    throw new Error(`Fiscal period ${this.fiscalPeriod} is locked`);
  }

  // ==========================================
  // 2. Get Required System Accounts (tenant-scoped)
  // ==========================================
  const accountFilter = this.companyId ? { companyId: this.companyId } : {};
  const [apAccount, vatInputAccount, whtPayableAccount, inventoryAccount, grniAccount] =
    await Promise.all([
      Account.findOne({ ...accountFilter, systemAccount: "accounts_payable" }),
      Account.findOne({ ...accountFilter, systemAccount: "vat_input" }),
      Account.findOne({ ...accountFilter, systemAccount: "wht_payable" }),
      Account.findOne({ ...accountFilter, systemAccount: "inventory" }),
      Account.findOne({ ...accountFilter, systemAccount: "grni" }),
    ]);

  if (!apAccount) {
    throw new Error("Accounts Payable system account not configured");
  }

  if (this.amounts.vat > 0 && !vatInputAccount) {
    throw new Error("VAT Input system account not configured");
  }

  if (this.amounts.wht > 0 && !whtPayableAccount) {
    throw new Error("WHT Payable system account not configured");
  }

  // Strict mode requires GR/IR clearing account so the bill can post a
  // valid pending-receipt liability. If it isn't configured, fail loud
  // rather than silently falling back to direct-inventory mode (which
  // would defeat the audit control the tenant just opted into).
  const hasInventoryLine = (this.lines || []).some(
    (l) =>
      l.product?.id &&
      l.account?.type === "asset" &&
      !l.weighbridgeRef?.ticketId,
  );
  if (requireGRN && hasInventoryLine && !grniAccount) {
    throw new Error(
      "Three-way match (requireGRN) is enabled but the GR/IR clearing account (systemAccount: \"grni\") is not configured. Add it to the Chart of Accounts before approving inventory bills.",
    );
  }

  // ==========================================
  // 3. Build Journal Entry Lines
  // ==========================================
  const jeLines = [];
  const stockMovements = [];

  // Process each bill line
  for (const line of this.lines) {
    const isInventoryPurchase =
      line.product?.id && line.account.type === "asset";

    if (isInventoryPurchase && inventoryAccount) {
      const hasWbReceipt = !!line.weighbridgeRef?.ticketId;

      if (hasWbReceipt && grniAccount) {
        // Goods already received via weighbridge: WB entry posted DR Inventory / CR GR/IR.
        // This bill clears the GR/IR liability: DR GR/IR, CR Accounts Payable.
        // Inventory account is NOT touched again — it was already debited at WB receipt.
        // No stock movement queued — WB connector already created it.
        jeLines.push({
          accountId:   grniAccount._id,
          accountCode: grniAccount.accountCode,
          accountName: grniAccount.accountName,
          accountType: "liability",
          debit:       line.amount,
          credit:      0,
          description: `GR/IR clearing — ${line.product.name || line.description} · WB ${line.weighbridgeRef.ticketNumber}`,
        });
      } else if (requireGRN && grniAccount) {
        // Strict three-way-match mode (SOP §10.1):
        // Bill posts DR GR/IR clearing, CR AP. The actual Inventory
        // debit + stock movement happen on GRN acceptance.
        jeLines.push({
          accountId:   grniAccount._id,
          accountCode: grniAccount.accountCode,
          accountName: grniAccount.accountName,
          accountType: "liability",
          debit:       line.amount,
          credit:      0,
          description: `GR/IR clearing — ${line.product.name || line.description} (pending GRN)`,
        });
        // No stock movement queued — admitted on GRN accept.
      } else {
        // Legacy / SMB direct-purchase path: debit Inventory and queue
        // stock movement.
        jeLines.push({
          accountId:   inventoryAccount._id,
          accountCode: inventoryAccount.accountCode,
          accountName: inventoryAccount.accountName,
          accountType: "asset",
          debit:       line.amount,
          credit:      0,
          description: `Purchase: ${line.product.name || line.description} (${line.quantity} ${line.unit})`,
        });

        // Queue stock movement (only for direct purchases — WB-backed lines skip this)
        stockMovements.push({
          productId: line.product.id,
          quantity: line.quantity,
          unitCost: line.unitPrice,
          totalCost: line.amount,
          description: line.description,
        });
      }
    } else {
      // Expense/Asset purchase - debit the specified account
      jeLines.push({
        accountId: line.account.id,
        accountCode: line.account.code,
        accountName: line.account.name,
        accountType: line.account.type,
        debit: line.amount,
        credit: 0,
        description: line.description,
      });
    }
  }

  // VAT Input (if applicable)
  if (this.amounts.vat > 0) {
    jeLines.push({
      accountId: vatInputAccount._id,
      accountCode: vatInputAccount.accountCode,
      accountName: vatInputAccount.accountName,
      accountType: "asset",
      debit: this.amounts.vat,
      credit: 0,
      description: `VAT Input - ${this.supplier.name}`,
    });
  }

  // WHT Payable (if applicable)
  if (this.amounts.wht > 0) {
    jeLines.push({
      accountId: whtPayableAccount._id,
      accountCode: whtPayableAccount.accountCode,
      accountName: whtPayableAccount.accountName,
      accountType: "liability",
      debit: 0,
      credit: this.amounts.wht,
      description: `WHT ${this.whtRate}% - ${this.supplier.name}`,
    });
  }

  // Accounts Payable (credit net payable)
  jeLines.push({
    accountId: apAccount._id,
    accountCode: apAccount.accountCode,
    accountName: apAccount.accountName,
    accountType: "liability",
    debit: 0,
    credit: this.amounts.netPayable,
    description: `Payable to ${this.supplier.name}`,
  });

  // ==========================================
  // 4. Validate JE is Balanced
  // ==========================================
  const totalDebits = jeLines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredits = jeLines.reduce((sum, l) => sum + l.credit, 0);

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new Error(
      `Journal entry not balanced: Debits ${totalDebits.toFixed(
        2,
      )} ≠ Credits ${totalCredits.toFixed(2)}`,
    );
  }

  // ==========================================
  // 5. Create Journal Entry
  // ==========================================
  const entryNumber = await this.generateJENumber();

  const journalEntry = new JournalEntry({
    companyId: this.companyId,
    entryNumber,
    entryDate: this.billDate,
    entryType: "purchase",
    description: `Bill ${this.billNumber} - ${this.supplier.name}`,
    lines: jeLines,
    party: {
      type: "supplier",
      id: this.supplier.partyId.toString(),
      name: this.supplier.name,
    },
    dueDate: this.dueDate,
    fiscalPeriod: this.fiscalPeriod,
    relatedDocuments: {
      billId: this._id,
      billNumber: this.billNumber,
    },
    status: "draft",
    createdBy: userInfo,
  });

  await journalEntry.save();

  // Post the journal entry
  try {
    await journalEntry.post(userInfo);
  } catch (postError) {
    await JournalEntry.findByIdAndDelete(journalEntry._id);
    throw new Error(`Failed to post journal entry: ${postError.message}`);
  }

  // ==========================================
  // 6. Create Stock Movements (if any)
  // ==========================================
  for (const sm of stockMovements) {
    try {
      const product = await Product.findById(sm.productId);
      if (product) {
        // Update product inventory
        if (typeof product.increaseInventory === "function") {
          await product.increaseInventory(
            sm.quantity,
            sm.unitCost,
            `Purchased via Bill ${this.billNumber}`,
          );
        }

        // Create stock movement record (with tenant scoping)
        const movementNumber = await StockMovement.generateMovementNumber(this.companyId);
        await StockMovement.create({
          companyId: this.companyId, // Tenant scoping
          movementNumber,
          productId: product._id,
          productSnapshot: {
            name: product.name,
            SKU: product.SKU,
            category: product.category,
            unit: product.unit,
          },
          movementType: "purchase",
          direction: "in",
          quantity: sm.quantity,
          costing: {
            unitCost: sm.unitCost,
            totalCost: sm.totalCost,
          },
          relatedDocuments: {
            billId: this._id,
            journalEntryId: journalEntry._id,
          },
          notes: sm.description,
          status: "posted",
          postedAt: new Date(),
          postedBy: userInfo,
          performedBy: userInfo,
        });
      }
    } catch (smError) {
      console.error(
        `Stock movement error for product ${sm.productId}:`,
        smError,
      );
      // Continue - don't fail the whole bill for stock movement issues
    }
  }

  // ==========================================
  // 7. Create Tax Transactions
  // ==========================================
  const taxTransactionIds = [];

  try {
    const taxTransactions = await TaxTransaction.createFromBill(this, userInfo);
    if (taxTransactions && taxTransactions.length > 0) {
      taxTransactionIds.push(...taxTransactions.map((t) => t._id));
    }
  } catch (taxError) {
    console.error("Tax transaction creation error:", taxError);
    // Continue - tax transactions can be created manually
  }

  // ==========================================
  // 8. Update Bill Status
  // ==========================================
  this.status = "approved";
  this.approvedAt = new Date();
  this.approvedBy = userInfo;
  this.accounting.journalEntryId = journalEntry._id;
  this.accounting.postedAt = new Date();
  this.accounting.postedBy = userInfo;
  // Track whether physical inventory was actually moved by the bill.
  // Strict mode (requireGRN) defers it to GRN acceptance — flip the
  // flags so the GRN actions know to do the inventory work themselves.
  this.accounting.inventoryMoved = !requireGRN || !hasInventoryLine;
  this.accounting.usedGRNI = requireGRN && hasInventoryLine;
  this.taxTransactions = taxTransactionIds;
  this.lastModifiedBy = userInfo;

  await this.save();

  // Mark any linked weighbridge tickets as GR/IR matched.
  // Collect unique ticket IDs from lines that have a weighbridgeRef.
  const wbTicketIds = [
    ...new Set(
      this.lines
        .filter((l) => l.weighbridgeRef?.ticketId)
        .map((l) => l.weighbridgeRef.ticketId.toString())
    ),
  ];

  if (wbTicketIds.length > 0) {
    const WeighbridgeTicket = mongoose.model("WeighbridgeTicket");
    await WeighbridgeTicket.updateMany(
      { _id: { $in: wbTicketIds } },
      { $set: { billId: this._id, billRef: this.billNumber } }
    );
  }

  return this;
};

// ============================================
// METHOD: Reject
// ============================================
billSchema.methods.reject = async function (user, reason) {
  if (this.status !== "submitted") {
    throw new Error(`Cannot reject bill in status: ${this.status}`);
  }

  const userInfo = formatUser(user);

  this.status = "rejected";
  this.rejectedAt = new Date();
  this.rejectedBy = userInfo;
  this.rejectionReason = reason || "No reason provided";
  this.lastModifiedBy = userInfo;

  await this.save();
  return this;
};

// ============================================
// METHOD: Cancel
// ============================================
billSchema.methods.cancel = async function (user, reason) {
  if (!this.canCancel) {
    throw new Error(`Cannot cancel bill in status: ${this.status}`);
  }

  const JournalEntry = mongoose.model("JournalEntry");
  const userInfo = formatUser(user);

  // Reverse journal entry if posted
  if (this.accounting.journalEntryId) {
    const je = await JournalEntry.findById(this.accounting.journalEntryId);
    if (je && je.status === "posted") {
      await je.reverse(
        userInfo,
        `Bill ${this.billNumber} cancelled: ${reason}`,
      );
    }
  }

  this.status = "cancelled";
  this.cancelledAt = new Date();
  this.cancelledBy = userInfo;
  this.cancellationReason = reason || "No reason provided";
  this.lastModifiedBy = userInfo;

  await this.save();
  return this;
};

// ============================================
// METHOD: Record Payment
// ============================================
billSchema.methods.recordPayment = async function (
  paymentId,
  paymentNumber,
  amount,
  method,
  reference,
  paidAt,
  recordedBy,
  session = null,
) {
  if (!this.canPay) {
    throw new Error(`Cannot record payment for bill in status: ${this.status}`);
  }

  if (amount <= 0) {
    throw new Error("Payment amount must be positive");
  }

  if (amount > this.amounts.balance + 0.01) {
    throw new Error(
      `Payment ${amount} exceeds balance ${this.amounts.balance}`,
    );
  }

  // Add payment to embedded array
  this.payments.push({
    paymentId,
    paymentNumber,
    amount,
    method,
    reference,
    paidAt: paidAt || new Date(),
    recordedBy: recordedBy || { name: "System", id: "system" },
  });

  // Update amounts
  this.amounts.paid += amount;
  this.amounts.balance = this.amounts.netPayable - this.amounts.paid;

  // Handle rounding
  if (Math.abs(this.amounts.balance) < 0.01) {
    this.amounts.balance = 0;
  }

  // Update payment status
  if (this.amounts.balance <= 0) {
    this.paymentStatus = "paid";
  } else {
    this.paymentStatus = "partial";
  }

  await this.save({ session });
  return this;
};

// ============================================
// METHOD: Reverse Payment (for payment cancellation)
// ============================================
billSchema.methods.reversePayment = async function (paymentId, amount) {
  // Find and remove the payment from array
  const paymentIndex = this.payments.findIndex(
    (p) => p.paymentId.toString() === paymentId.toString(),
  );

  if (paymentIndex === -1) {
    throw new Error("Payment not found on this bill");
  }

  // Remove from array
  this.payments.splice(paymentIndex, 1);

  // Update amounts
  this.amounts.paid = Math.max(0, this.amounts.paid - amount);
  this.amounts.balance = this.amounts.netPayable - this.amounts.paid;

  // Update payment status
  if (this.amounts.paid <= 0) {
    this.paymentStatus = "unpaid";
  } else if (this.amounts.balance > 0) {
    this.paymentStatus = "partial";
  }

  await this.save();
  return this;
};

// ============================================
// METHOD: Generate JE Number
// ============================================
billSchema.methods.generateJENumber = async function (session = null) {
  const { generateUniqueEntryNumber } =
    await import("@/lib/utils/server-utils");
  return generateUniqueEntryNumber("BILL", this.companyId, session);
};

// ============================================
// STATIC: Generate Bill Number
// ============================================
// ============================================
// ATOMIC BILL NUMBER GENERATION
// ============================================
// Add this to your Counter model or create one:

// ============================================
// STATIC: Generate Bill Number (Atomic with Verification)
// ============================================
billSchema.statics.generateBillNumber = async function (
  companyId = null,
  session = null,
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
    date.getMonth() + 1,
  ).padStart(2, "0")}`;

  // Build prefix with company code: BILL-{CODE}-{YYYYMM}
  const prefix = companyCode
    ? `BILL-${companyCode}-${yearMonth}`
    : `BILL-${yearMonth}`;

  // Counter key includes company code for tenant isolation
  const counterId = companyCode
    ? `bill-${companyCode.toLowerCase()}-${yearMonth}`
    : `bill-${yearMonth}`;

  // Build tenant filter for queries
  const tenantFilter = companyId ? { companyId } : {};

  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const seq = await ErpCounter.getNextSequence(
        counterId,
        companyId,
        session,
      );
      const billNumber = `${prefix}-${String(seq).padStart(4, "0")}`;

      // Verify this number doesn't already exist (handles stale counters)
      let existsQuery = this.exists({ ...tenantFilter, billNumber });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;

      if (!exists) {
        return billNumber;
      }

      // Number exists - counter was stale, try again
      console.warn(`Bill number ${billNumber} already exists, retrying...`);
      continue;
    } catch (counterError) {
      // Counter failed - use query-based fallback
      console.warn(
        `Counter failed for ${counterId}, attempt ${attempt + 1}:`,
        counterError.message,
      );

      // Escape special regex characters in prefix
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let findQuery = this.findOne({
        ...tenantFilter,
        billNumber: { $regex: `^${escapedPrefix}-\\d+$` },
      })
        .sort({ billNumber: -1 })
        .lean();
      if (session) findQuery = findQuery.session(session);
      const lastBill = await findQuery;

      let nextNum = 1;
      if (lastBill?.billNumber) {
        const match = lastBill.billNumber.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }

      const billNumber = `${prefix}-${String(nextNum).padStart(4, "0")}`;

      let existsQuery = this.exists({ ...tenantFilter, billNumber });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;

      if (!exists) {
        return billNumber;
      }
    }

    // Exponential backoff before retry
    await new Promise((resolve) =>
      setTimeout(resolve, 50 * Math.pow(2, attempt)),
    );
  }

  // Ultimate fallback with timestamp - guaranteed unique
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 4).toUpperCase();
  return `${prefix}-${timestamp}${random}`;
};

// ============================================
// STATIC: Get by Supplier
// ============================================
billSchema.statics.getBySupplier = function (supplierId, status = null) {
  const query = { "supplier.partyId": supplierId };
  if (status) {
    query.status = Array.isArray(status) ? { $in: status } : status;
  }
  return this.find(query).sort({ billDate: -1 });
};

// ============================================
// STATIC: Get Unpaid
// ============================================
billSchema.statics.getUnpaid = function () {
  return this.find({
    status: "approved",
    paymentStatus: { $in: ["unpaid", "partial"] },
  }).sort({ dueDate: 1 });
};

// ============================================
// STATIC: Get Overdue
// ============================================
billSchema.statics.getOverdue = function () {
  return this.find({
    status: "approved",
    paymentStatus: { $in: ["unpaid", "partial"] },
    dueDate: { $lt: new Date() },
  }).sort({ dueDate: 1 });
};

// ============================================
// STATIC: Get AP Aging
// ============================================
billSchema.statics.getAPAging = async function () {
  const now = new Date();
  const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const d60 = new Date(now - 60 * 24 * 60 * 60 * 1000);
  const d90 = new Date(now - 90 * 24 * 60 * 60 * 1000);

  return this.aggregate([
    {
      $match: {
        status: "approved",
        paymentStatus: { $in: ["unpaid", "partial"] },
      },
    },
    {
      $project: {
        balance: "$amounts.balance",
        dueDate: 1,
        supplier: 1,
        bucket: {
          $switch: {
            branches: [
              { case: { $gte: ["$dueDate", now] }, then: "current" },
              { case: { $gte: ["$dueDate", d30] }, then: "1-30" },
              { case: { $gte: ["$dueDate", d60] }, then: "31-60" },
              { case: { $gte: ["$dueDate", d90] }, then: "61-90" },
            ],
            default: "90+",
          },
        },
      },
    },
    {
      $group: {
        _id: "$bucket",
        total: { $sum: "$balance" },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Bill = models?.Bill;
//
if (!Bill) {
  Bill = mongoose.model("Bill", billSchema);
}

export default Bill;

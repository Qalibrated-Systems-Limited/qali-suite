import mongoose from "mongoose";

// Import FiscalPeriod model for fiscal period validation
import "@/app/models/fiscalPeriod";

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
// INVOICE SCHEMA - ACCOUNTS RECEIVABLE (WITH COGS)
// ============================================
const invoiceSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Invoice Identification
    invoiceNumber: {
      type: String,
      required: [true, "Invoice number is required"],
      index: true,
    },

    invoiceDate: {
      type: Date,
      required: [true, "Invoice date is required"],
      index: true,
    },

    dueDate: {
      type: Date,
      required: [true, "Due date is required"],
      index: true,
      validate: {
        validator: function (value) {
          return value >= this.invoiceDate;
        },
        message: "Due date cannot be before invoice date",
      },
    },

    // Fiscal period for accounting (YYYY-MM format)
    fiscalPeriod: {
      type: String,
      match: [/^\d{4}-\d{2}$/, "Fiscal period must be YYYY-MM format"],
      index: true,
    },

    // Customer Information
    customer: {
      id: {
        type: String,
        required: [true, "Customer ID is required"],
        index: true,
      },
      name: {
        type: String,
        required: [true, "Customer name is required"],
        trim: true,
      },
      email: {
        type: String,
        trim: true,
        lowercase: true,
      },
      phone: {
        type: String,
        trim: true,
      },
      address: String,
      taxPin: {
        type: String,
        trim: true,
        uppercase: true,
      },
    },

    // ============================================
    // INVOICE ITEMS (PRODUCTS + SERVICES)
    // ============================================
    items: {
      type: [
        {
          // Item type
          itemType: {
            type: String,
            enum: ["product", "service"],
            required: [true, "Item type is required"],
          },

          // Service category (for services only)
          serviceCategory: {
            type: String,
            enum: [
              "labor",           // Labor/hourly rate
              "mileage",         // Transport/km
              "accommodation",   // Nightouts/hotels
              "installation",    // Installation fee
              "consultation",    // Consultation/advisory
              "maintenance",     // Maintenance fee
              "repair",          // Repair fee
              "other",           // Other services
            ],
            // Required if itemType is "service"
          },

          // Product reference (for products only)
          productId: {
            type: Schema.Types.ObjectId,
            ref: "Product",
            // Required if itemType is "product"
          },
          productSKU: String,
          productName: String,

          // Common fields
          description: {
            type: String,
            required: [true, "Description is required"],
            trim: true,
          },

          unit: {
            type: String,
            default: "pcs",
          },

          quantity: {
            type: Number,
            required: [true, "Quantity is required"],
            min: [0.001, "Quantity must be greater than zero"],
          },

          unitPrice: {
            type: Number,
            required: [true, "Unit price is required"],
            min: [0, "Unit price cannot be negative"],
          },

          amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: [0, "Amount cannot be negative"],
          },

          // ============================================
          // COSTING (FOR PRODUCTS)
          // ============================================
          costing: {
            unitCost: {
              type: Number,
              default: 0,
              // Cost per unit at time of sale (for COGS)
            },
            totalCost: {
              type: Number,
              default: 0,
              // Total COGS for this line
            },
            grossProfit: {
              type: Number,
              default: 0,
              // amount - totalCost
            },
            marginPercentage: {
              type: Number,
              default: 0,
              // (grossProfit / amount) × 100
            },
          },

          // VAT
          taxRate: {
            type: Number,
            default: 16, // Kenya VAT 16%
            min: [0, "Tax rate cannot be negative"],
            max: [100, "Tax rate cannot exceed 100%"],
          },

          taxAmount: {
            type: Number,
            default: 0,
            min: [0, "Tax amount cannot be negative"],
          },

          // Discount (optional)
          discountPercentage: {
            type: Number,
            default: 0,
            min: [0, "Discount cannot be negative"],
            max: [100, "Discount cannot exceed 100%"],
          },

          discountAmount: {
            type: Number,
            default: 0,
            min: [0, "Discount amount cannot be negative"],
          },

          // ============================================
          // RELATED REQUEST (FOR TECHNICIAN STOCK)
          // ============================================
          relatedRequest: {
            requestId: {
              type: Schema.Types.ObjectId,
              ref: "StockRequest",
            },
            requestNumber: String,
            technicianId: String,
            technicianName: String,
            // If this exists, COGS will credit Technician Stock instead of Inventory
          },

          // Related checkout (for demo/installation conversions)
          relatedCheckout: {
            checkoutId: {
              type: Schema.Types.ObjectId,
              ref: "ItemCheckout",
            },
            checkoutNumber: String,
          },

          // ============================================
          // INVENTORY TRACKING
          // ============================================
          // stockCommitted: true = inventory was reserved during draft creation
          // This field indicates the item follows the commitment-based flow:
          // - Draft: quantityCommitted increased, quantityAvailable decreased
          // - Complete: quantityOnHand decreased, quantityCommitted decreased
          // - Cancel: quantityCommitted decreased, quantityAvailable increased
          stockCommitted: {
            type: Boolean,
            default: false,
          },
        },
      ],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: "Invoice must have at least one item",
      },
    },

    // ============================================
    // AMOUNTS
    // ============================================
    subtotal: {
      type: Number,
      required: [true, "Subtotal is required"],
      min: [0, "Subtotal cannot be negative"],
    },

    discountPercentage: {
      type: Number,
      default: 0,
      min: [0, "Discount percentage cannot be negative"],
      max: [100, "Discount percentage cannot exceed 100"],
    },

    totalDiscount: {
      type: Number,
      default: 0,
      min: [0, "Discount cannot be negative"],
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: [0, "Tax amount cannot be negative"],
    },

    total: {
      type: Number,
      required: [true, "Total is required"],
      min: [0.01, "Total must be greater than zero"],
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
      trim: true,
    },

    // ============================================
    // COSTING & PROFITABILITY (CALCULATED)
    // ============================================
    totalCOGS: {
      type: Number,
      default: 0,
      // Sum of all item.costing.totalCost
    },

    grossProfit: {
      type: Number,
      default: 0,
      // subtotal - totalCOGS
    },

    grossMarginPercentage: {
      type: Number,
      default: 0,
      // (grossProfit / subtotal) × 100
    },

    // ============================================
    // PAYMENT TRACKING
    // ============================================
    paymentStatus: {
      type: String,
      enum: {
        values: ["unpaid", "partial", "paid", "overdue"],
        message: "{VALUE} is not a valid payment status",
      },
      default: "unpaid",
      index: true,
    },

    amountPaid: {
      type: Number,
      default: 0,
      min: [0, "Amount paid cannot be negative"],
    },

    amountDue: {
      type: Number,
      default: 0,
    },

    // Payment History
    paymentHistory: [
      {
        paymentId: {
          type: Schema.Types.ObjectId,
          ref: "Payment",
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        paymentDate: {
          type: Date,
          required: true,
        },
        paymentNumber: String,
        paymentMethod: String,
      },
    ],

    // ============================================
    // ACCOUNTING LINKS
    // ============================================
    accounting: {
      // Revenue journal entry
      revenueJournalEntryId: {
        type: Schema.Types.ObjectId,
        ref: "JournalEntry",
        index: true,
      },

      // COGS journal entry
      cogsJournalEntryId: {
        type: Schema.Types.ObjectId,
        ref: "JournalEntry",
        index: true,
      },

      // Both posted?
      accountingComplete: {
        type: Boolean,
        default: false,
      },

      accountingCompletedAt: Date,
    },

    // ============================================
    // STATUS & WORKFLOW
    // ============================================
    status: {
      type: String,
      enum: {
        values: ["draft", "sent", "completed", "cancelled", "void", "expired"],
        message: "{VALUE} is not a valid status",
      },
      default: "draft",
      index: true,
    },

    sentAt: Date,
    sentBy: {
      name: String,
      id: String,
    },

    completedAt: Date,
    completedBy: {
      name: String,
      id: String,
    },

    cancelledAt: Date,
    cancelledBy: {
      name: String,
      id: String,
    },
    cancellationReason: String,

    // ============================================
    // DRAFT EXPIRY (for invoices holding committed stock)
    // ============================================
    // Only set for invoices with stockCommitted items
    // When this date passes, committed stock is auto-released
    draftExpiresAt: {
      type: Date,
      index: true,
    },

    expiredAt: Date,
    expiredBy: {
      name: String,
      id: String,
    },

    // ============================================
    // ADDITIONAL INFO
    // ============================================
    paymentTerms: {
      type: String,
      default: "Net 30",
    },

    referenceNumber: String,
    purchaseOrderNumber: String,

    // ============================================
    // QUOTE REFERENCE (optional - if created from quote)
    // ============================================
    quoteRef: {
      quoteId: {
        type: Schema.Types.ObjectId,
        ref: "Quote",
        index: true,
      },
      quoteNumber: String,
    },

    // ============================================
    // SOURCE TRACKING (how this invoice was created)
    // ============================================
    source: {
      type: {
        type: String,
        enum: [
          "direct",           // Direct sale
          "stock_request",    // From stock request fulfillment
          "checkout_conversion", // From checkout conversion (demo/installation)
          "quote",            // Converted from quote
          "recurring",        // Recurring invoice
        ],
        default: "direct",
      },
      // For stock_request source
      requestId: {
        type: Schema.Types.ObjectId,
        ref: "StockRequest",
      },
      requestNumber: String,
      // For checkout_conversion source
      checkoutIds: [{
        type: Schema.Types.ObjectId,
        ref: "ItemCheckout",
      }],
    },

    notes: String,
    termsAndConditions: String,

    // Attachments
    attachments: [
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

    // ============================================
    // DELIVERY TRACKING
    // ============================================
    deliveryInfo: {
      deliveryNoteId: {
        type: Schema.Types.ObjectId,
        ref: "DeliveryNote",
      },
      deliveryNumber: String,
      deliveryDate: Date,
      deliveryAddress: String,
      deliveryStatus: {
        type: String,
        enum: ["pending", "delivered", "partial"],
      },
    },

    // ============================================
    // CREDIT NOTES
    // ============================================
    creditNotes: [
      {
        creditNoteId: {
          type: Schema.Types.ObjectId,
          ref: "CreditNote",
        },
        creditNoteNumber: String,
        amount: {
          type: Number,
          min: 0,
        },
        date: Date,
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
// INDEXES
// ============================================
// Unique invoice number per company
invoiceSchema.index({ companyId: 1, invoiceNumber: 1 }, { unique: true });
// Query indexes
invoiceSchema.index({ companyId: 1, invoiceDate: -1, status: 1 });
invoiceSchema.index({ companyId: 1, dueDate: 1, paymentStatus: 1 });
invoiceSchema.index({ companyId: 1, "customer.id": 1, status: 1 });
invoiceSchema.index({ companyId: 1, paymentStatus: 1, dueDate: 1 });
invoiceSchema.index({ companyId: 1, status: 1, invoiceDate: -1 });
invoiceSchema.index({ companyId: 1, "accounting.accountingComplete": 1 });
invoiceSchema.index({ companyId: 1, fiscalPeriod: 1, status: 1 });
// Draft expiry index - for finding stale drafts with committed stock
invoiceSchema.index({ companyId: 1, status: 1, draftExpiresAt: 1 });

// ============================================
// PRE-SAVE: Auto-assign fiscal period from invoiceDate
// ============================================
invoiceSchema.pre("save", function (next) {
  // Set fiscal period from invoice date if not set
  if (!this.fiscalPeriod && this.invoiceDate) {
    const d = new Date(this.invoiceDate);
    this.fiscalPeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
});

// ============================================
// VIRTUALS
// ============================================
invoiceSchema.virtual("isOverdue").get(function () {
  // Only completed, unpaid/partial invoices can be overdue
  if (this.paymentStatus === "paid") return false;
  if (this.status !== "completed") return false;
  return new Date() > this.dueDate;
});

invoiceSchema.virtual("daysOverdue").get(function () {
  if (!this.isOverdue) return 0;
  const diff = new Date() - this.dueDate;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
});

invoiceSchema.virtual("isFullyPaid").get(function () {
  return this.paymentStatus === "paid";
});

invoiceSchema.virtual("hasProducts").get(function () {
  return this.items.some((item) => item.itemType === "product");
});

invoiceSchema.virtual("hasServices").get(function () {
  return this.items.some((item) => item.itemType === "service");
});

invoiceSchema.virtual("needsCOGSEntry").get(function () {
  return this.hasProducts && !this.accounting?.cogsJournalEntryId;
});

invoiceSchema.virtual("isDraftExpired").get(function () {
  // Only drafts with expiry dates can expire
  if (this.status !== "draft" && this.status !== "sent") return false;
  if (!this.draftExpiresAt) return false;
  return new Date() > this.draftExpiresAt;
});

invoiceSchema.virtual("hasCommittedStock").get(function () {
  return this.items.some((item) => item.stockCommitted === true);
});

// ============================================
// VALIDATION METHODS
// ============================================

/**
 * Validate line items
 */
invoiceSchema.methods.validateItems = function () {
  for (const item of this.items) {
    // Validate amount = quantity × unitPrice - discount
    const expectedAmount =
      item.quantity * item.unitPrice - (item.discountAmount || 0);

    if (Math.abs(expectedAmount - item.amount) > 0.01) {
      throw new Error(
        `Amount mismatch for "${item.description}". ` +
          `Expected: ${expectedAmount.toFixed(2)}, Got: ${item.amount}`,
      );
    }

    // Validate tax calculation
    if (item.taxRate > 0) {
      const expectedTax = (item.amount * item.taxRate) / 100;
      if (Math.abs(expectedTax - item.taxAmount) > 0.01) {
        throw new Error(
          `Tax calculation incorrect for "${item.description}". ` +
            `Expected: ${expectedTax.toFixed(2)}, Got: ${item.taxAmount}`,
        );
      }
    }

    // Validate product items have productId
    if (item.itemType === "product" && !item.productId) {
      throw new Error(
        `Product item "${item.description}" must have a productId`,
      );
    }
  }

  return true;
};

/**
 * Validate amounts
 */
invoiceSchema.methods.validateAmounts = function () {
  // Calculate subtotal from items
  const calculatedSubtotal = this.items.reduce(
    (sum, item) => sum + (item.amount || 0),
    0,
  );

  if (Math.abs(calculatedSubtotal - this.subtotal) > 0.01) {
    throw new Error(
      `Subtotal mismatch. Expected: ${calculatedSubtotal.toFixed(2)}, Got: ${
        this.subtotal
      }`,
    );
  }

  // Calculate total discount - supports two approaches:
  // 1. Invoice-level discountPercentage (preferred) - discount = subtotal * percentage
  // 2. Per-item discounts (legacy) - discount = sum of item.discountAmount
  let calculatedDiscount;
  if (this.discountPercentage && this.discountPercentage > 0) {
    // Invoice-level percentage discount
    calculatedDiscount = (calculatedSubtotal * this.discountPercentage) / 100;
  } else {
    // Sum of per-item discounts (legacy approach)
    calculatedDiscount = this.items.reduce(
      (sum, item) => sum + (item.discountAmount || 0),
      0,
    );
  }

  if (Math.abs(calculatedDiscount - (this.totalDiscount || 0)) > 0.01) {
    throw new Error(
      `Discount mismatch. Expected: ${calculatedDiscount.toFixed(2)}, Got: ${
        this.totalDiscount || 0
      }`,
    );
  }

  // Calculate total tax - apply discount factor since item.taxAmount is pre-discount
  // but invoice-level taxAmount has discount proportionally applied
  const itemTaxSum = this.items.reduce(
    (sum, item) => sum + (item.taxAmount || 0),
    0,
  );

  // Calculate discount factor: when discount is applied, tax is reduced proportionally
  const subtotalAfterDiscount = calculatedSubtotal - (this.totalDiscount || 0);
  const discountFactor = calculatedSubtotal > 0 ? subtotalAfterDiscount / calculatedSubtotal : 1;
  const calculatedTax = itemTaxSum * discountFactor;

  if (Math.abs(calculatedTax - this.taxAmount) > 0.01) {
    throw new Error(
      `Tax mismatch. Expected: ${calculatedTax.toFixed(2)}, Got: ${
        this.taxAmount
      }`,
    );
  }

  // Validate total: subtotal - discount + tax = total
  const calculatedTotal = this.subtotal - this.totalDiscount + this.taxAmount;

  if (Math.abs(calculatedTotal - this.total) > 0.01) {
    throw new Error(
      `Total mismatch. Subtotal (${this.subtotal}) - Discount (${this.totalDiscount}) + Tax (${this.taxAmount}) = ` +
        `${calculatedTotal.toFixed(2)}, but total is ${this.total}`,
    );
  }

  // Calculate amount due
  this.amountDue = this.total - (this.amountPaid || 0);
  if (this.amountDue < 0) {
    this.amountDue = 0;
  }

  return true;
};

/**
 * Calculate COGS for product items
 */
invoiceSchema.methods.calculateCOGS = async function () {
  const Product = mongoose.model("Product");
  let totalCOGS = 0;

  for (const item of this.items) {
    if (item.itemType === "product" && item.productId) {
      const product = await Product.findById(item.productId);

      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }

      // Calculate COGS for this line
      const unitCost = product.costing?.costPrice || 0;
      const lineCOGS = item.quantity * unitCost;
      const lineGrossProfit = item.amount - lineCOGS;
      const lineMargin =
        item.amount > 0 ? (lineGrossProfit / item.amount) * 100 : 0;

      // Update item costing
      item.costing = {
        unitCost,
        totalCost: lineCOGS,
        grossProfit: lineGrossProfit,
        marginPercentage: lineMargin,
      };

      totalCOGS += lineCOGS;
    } else if (item.itemType === "service") {
      // Services have no COGS
      item.costing = {
        unitCost: 0,
        totalCost: 0,
        grossProfit: item.amount,
        marginPercentage: 100,
      };
    }
  }

  // Update invoice totals
  this.totalCOGS = totalCOGS;
  this.grossProfit = this.subtotal - totalCOGS;
  this.grossMarginPercentage =
    this.subtotal > 0 ? (this.grossProfit / this.subtotal) * 100 : 0;

  return {
    totalCOGS,
    grossProfit: this.grossProfit,
    grossMarginPercentage: this.grossMarginPercentage,
  };
};

/**
 * Complete validation
 */
invoiceSchema.methods.validateBeforeCompletion = async function () {
  this.validateItems();
  this.validateAmounts();
  await this.calculateCOGS();
  return true;
};

// ============================================
// COMPLETE INVOICE (CREATE JOURNAL ENTRIES + STOCK MOVEMENTS)
// ============================================
invoiceSchema.methods.complete = async function (completedBy) {
  if (this.status !== "draft" && this.status !== "sent") {
    throw new Error(
      `Can only complete draft or sent invoices. Current status: ${this.status}`,
    );
  }

  const userInfo = formatUserForAudit(completedBy);

  // Validate
  await this.validateBeforeCompletion();

  // ==========================================
  // FISCAL PERIOD VALIDATION
  // ==========================================
  const FiscalPeriod = mongoose.model("FiscalPeriod");

  // Ensure fiscal period is set
  if (!this.fiscalPeriod && this.invoiceDate) {
    const d = new Date(this.invoiceDate);
    this.fiscalPeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // Find or create fiscal period
  const periodFilter = {
    periodCode: this.fiscalPeriod,
  };
  if (this.companyId) {
    periodFilter.companyId = this.companyId;
  }

  let fiscalPeriod = await FiscalPeriod.findOne(periodFilter);

  if (!fiscalPeriod) {
    // Auto-create the fiscal period from invoice's fiscalPeriod (YYYY-MM)
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

  let revenueJE = null;
  let cogsJE = null;
  const stockMovements = [];

  try {
    // 1. Create revenue journal entry
    revenueJE = await this.createRevenueJournalEntry(userInfo);
    this.accounting = this.accounting || {};
    this.accounting.revenueJournalEntryId = revenueJE._id;

    // 2. Create COGS journal entry + stock movements (if products)
    if (this.hasProducts) {
      const result = await this.createCOGSJournalEntry(userInfo);
      cogsJE = result.journalEntry;
      stockMovements.push(...result.stockMovements);
      // Only set cogsJournalEntryId if journal entry was created (may be null for zero-cost items)
      if (cogsJE?._id) {
        this.accounting.cogsJournalEntryId = cogsJE._id;
      }
    }

    // 3. Update status
    this.status = "completed";
    this.completedAt = new Date();
    this.completedBy = userInfo;
    this.lastModifiedBy = userInfo;
    this.accounting.accountingComplete = true;
    this.accounting.accountingCompletedAt = new Date();

    // 4. Create VAT Output tax transaction (if tax amount > 0)
    if (this.taxAmount > 0) {
      const TaxTransaction = mongoose.model("TaxTransaction");
      await TaxTransaction.createFromInvoice(this, userInfo);
    }

    await this.save();

    return this;
  } catch (error) {
    // Rollback on error
    await this.rollbackCompletion(userInfo, {
      revenueJE,
      cogsJE,
      stockMovements,
    });
    throw new Error(`Invoice completion failed: ${error.message}`);
  }
};

/**
 * Create revenue journal entry (AR + Revenue + VAT Output)
 */
invoiceSchema.methods.createRevenueJournalEntry = async function (user) {
  if (this.accounting?.revenueJournalEntryId) {
    throw new Error("Revenue journal entry already exists");
  }

  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  // Get accounts (tenant-scoped)
  const arAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "accounts_receivable",
  });
  const revenueAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "sales_revenue",
  });
  const vatOutputAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "vat_output",
  });

  if (!arAccount || !revenueAccount) {
    throw new Error(
      "AR or Sales Revenue accounts not configured for this company",
    );
  }

  const lines = [];

  // Debit: AR (total including VAT)
  lines.push({
    accountId: arAccount._id,
    accountCode: arAccount.accountCode,
    accountName: arAccount.accountName,
    accountType: arAccount.accountType,
    debit: this.total,
    credit: 0,
    description: `Sale to ${this.customer.name}`,
  });

  // Credit: Revenue (subtotal minus discount = net sales)
  const netRevenue = this.subtotal - (this.totalDiscount || 0);
  lines.push({
    accountId: revenueAccount._id,
    accountCode: revenueAccount.accountCode,
    accountName: revenueAccount.accountName,
    accountType: revenueAccount.accountType,
    debit: 0,
    credit: netRevenue,
    description: `Sales revenue - ${this.customer.name}${this.totalDiscount > 0 ? ` (${this.discountPercentage || 0}% discount applied)` : ""}`,
  });

  // Credit: VAT Output (if applicable)
  if (this.taxAmount > 0) {
    if (!vatOutputAccount) {
      throw new Error("VAT Output account not configured for this company");
    }

    lines.push({
      accountId: vatOutputAccount._id,
      accountCode: vatOutputAccount.accountCode,
      accountName: vatOutputAccount.accountName,
      accountType: vatOutputAccount.accountType,
      debit: 0,
      credit: this.taxAmount,
      description: `VAT Output on sales`,
    });
  }

  // Validate balance
  const totalDebits = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredits = lines.reduce((sum, line) => sum + (line.credit || 0), 0);

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new Error(
      `Revenue journal entry not balanced! Debits: ${totalDebits}, Credits: ${totalCredits}`,
    );
  }

  // Generate entry number
  const entryNumber = await this.generateUniqueEntryNumber("SALE");

  // Create journal entry (with tenant scoping)
  const journalEntry = await JournalEntry.create({
    companyId: this.companyId, // Tenant scoping
    entryNumber,
    entryDate: this.invoiceDate,
    entryType: "sale",
    description: `Sale - Invoice ${this.invoiceNumber}`,
    lines,
    party: {
      type: "customer",
      id: this.customer.id,
      name: this.customer.name,
      email: this.customer.email,
      phone: this.customer.phone,
    },
    dueDate: this.dueDate,
    amountOutstanding: this.total,
    relatedDocuments: {
      invoiceId: this._id,
      invoiceNumber: this.invoiceNumber,
    },
    status: "draft",
    createdBy: user,
  });

  // Post journal entry
  await journalEntry.post(user);

  return journalEntry;
};

/**
 * Create COGS journal entry + stock movements (COGS + Inventory reduction)
 */
invoiceSchema.methods.createCOGSJournalEntry = async function (user) {
  if (this.accounting?.cogsJournalEntryId) {
    throw new Error("COGS journal entry already exists");
  }

  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");
  const Product = mongoose.model("Product");
  const StockMovement = mongoose.model("StockMovement");

  // Get accounts - need both Inventory and Technician Stock (tenant-scoped)
  const cogsAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "cogs",
  });
  const inventoryAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "inventory",
  });
  const technicianStockAccount = await Account.findOne({
    companyId: this.companyId,
    systemAccount: "technician_stock",
  });

  if (!cogsAccount) {
    throw new Error("COGS account not configured for this company");
  }

  // Separate items by source
  let totalCOGSFromInventory = 0; // Direct sales
  let totalCOGSFromTechStock = 0; // Sales from technician requests
  const stockMovements = [];
  const itemsFromInventory = [];
  const itemsFromTechStock = [];

  for (const item of this.items) {
    if (item.itemType !== "product" || !item.productId) continue;

    const product = await Product.findById(item.productId);

    if (!product) {
      throw new Error(`Product not found: ${item.productId}`);
    }

    // Check if item is from technician stock (either via request or direct checkout)
    const isFromTechnicianStock = !!(item.relatedRequest?.requestId || item.relatedCheckout?.checkoutId);

    // Check if stock was pre-committed (new commitment-based flow)
    const isStockCommitted = item.stockCommitted === true;

    const lineCOGS = item.quantity * (product.costing?.costPrice || 0);

    // Categorize by source
    if (isFromTechnicianStock) {
      // Item came from technician stock (via request fulfillment or direct checkout)
      totalCOGSFromTechStock += lineCOGS;
      itemsFromTechStock.push({ item, product, lineCOGS });
    } else {
      // Direct sale from inventory
      totalCOGSFromInventory += lineCOGS;
      itemsFromInventory.push({ item, product, lineCOGS });
    }

    // ============================================
    // FULFILL INVENTORY (only for store inventory items)
    // ============================================
    if (!isFromTechnicianStock) {
      const previousOnHand = product.inventory?.quantityOnHand || 0;

      if (isStockCommitted) {
        // COMMITTED FLOW: Stock was reserved during draft creation
        // - Decrease quantityOnHand (physical stock goes out)
        // - Decrease quantityCommitted (reservation is fulfilled)
        // - quantityAvailable stays the same (was already reduced during commit)
        if (item.quantity > (product.inventory?.quantityOnHand || 0)) {
          throw new Error(
            `Insufficient physical stock for ${product.name}. ` +
              `On-hand: ${product.inventory?.quantityOnHand || 0}, Committed: ${item.quantity}`,
          );
        }

        product.inventory = product.inventory || {};
        product.inventory.quantityOnHand = previousOnHand - item.quantity;
        product.inventory.quantityCommitted =
          (product.inventory.quantityCommitted || 0) - item.quantity;
        // quantityAvailable stays unchanged (pre-save hook will recalculate)
        await product.save();
      } else {
        // LEGACY FLOW: Stock not pre-committed, check availability now
        const available = product.inventory?.quantityAvailable || 0;
        if (item.quantity > available) {
          throw new Error(
            `Insufficient stock for ${product.name}. ` +
              `Available: ${available}, Requested: ${item.quantity}`,
          );
        }

        await product.decreaseInventory(
          item.quantity,
          `Sold on invoice ${this.invoiceNumber}`,
        );
      }
    }
    // Note: For technician stock items, inventory was already decreased during checkout

    // Update product lifetime totals
    product.lifetimeTotals = product.lifetimeTotals || {};
    product.lifetimeTotals.totalQuantitySold =
      (product.lifetimeTotals.totalQuantitySold || 0) + item.quantity;
    product.lifetimeTotals.totalRevenue =
      (product.lifetimeTotals.totalRevenue || 0) + item.amount;
    product.lifetimeTotals.totalCOGS =
      (product.lifetimeTotals.totalCOGS || 0) + lineCOGS;
    product.lifetimeTotals.totalGrossProfit =
      (product.lifetimeTotals.totalGrossProfit || 0) + (item.amount - lineCOGS);
    await product.save();
  }

  // ============================================
  // CREATE STOCK MOVEMENTS (only for direct sales from inventory)
  // ============================================
  for (const { item, product, lineCOGS } of itemsFromInventory) {
    const movementNumber = await StockMovement.generateMovementNumber(
      this.companyId,
    );

    const movement = await StockMovement.create({
      companyId: this.companyId, // Tenant scoping
      movementNumber,
      productId: product._id,
      productSnapshot: {
        name: product.name,
        SKU: product.SKU,
        category: product.category,
        unit: product.unit,
      },
      movementType: "sale",
      direction: "out",
      quantity: item.quantity,
      previousStock: product.inventory.quantityOnHand + item.quantity,
      newStock: product.inventory.quantityOnHand,
      costing: {
        unitCost: product.costing.costPrice,
        totalCost: lineCOGS,
        unitPrice: item.unitPrice,
        totalValue: item.amount,
        averageCostAtMovement: product.costing.costPrice,
      },
      performedBy: {
        name: user.name,
        id: user.id,
        role: "system",
      },
      relatedDocuments: {
        invoiceId: this._id,
      },
      notes: `Direct sale to ${this.customer.name} - Invoice ${this.invoiceNumber}`,
      reason: item.description,
      status: "posted",
      postedAt: new Date(),
      postedBy: user,
      accounting: {
        affectsAccounting: true,
        accountingPosted: false,
      },
    });

    stockMovements.push(movement);
  }

  // ============================================
  // CREATE COGS JOURNAL ENTRY (Smart Routing)
  // ============================================
  const totalCOGS = totalCOGSFromInventory + totalCOGSFromTechStock;

  if (totalCOGS === 0) {
    // No products sold (services only)
    return { journalEntry: null, stockMovements };
  }

  const entryNumber = await this.generateUniqueEntryNumber("COGS");
  const journalLines = [];

  // DEBIT: Cost of Goods Sold (always)
  journalLines.push({
    accountId: cogsAccount._id,
    accountCode: cogsAccount.accountCode,
    accountName: cogsAccount.accountName,
    accountType: cogsAccount.accountType,
    debit: totalCOGS,
    credit: 0,
    description: `Cost of goods sold`,
  });

  // CREDIT: Inventory (for direct sales)
  if (totalCOGSFromInventory > 0) {
    if (!inventoryAccount) {
      throw new Error("Inventory account not configured for this company");
    }
    journalLines.push({
      accountId: inventoryAccount._id,
      accountCode: inventoryAccount.accountCode,
      accountName: inventoryAccount.accountName,
      accountType: inventoryAccount.accountType,
      debit: 0,
      credit: totalCOGSFromInventory,
      description: `From inventory (direct sales)`,
    });
  }

  // CREDIT: Technician Stock (for sales from requests or checkouts)
  if (totalCOGSFromTechStock > 0) {
    if (!technicianStockAccount) {
      throw new Error(
        "Technician Stock account not configured for this company",
      );
    }
    journalLines.push({
      accountId: technicianStockAccount._id,
      accountCode: technicianStockAccount.accountCode,
      accountName: technicianStockAccount.accountName,
      accountType: technicianStockAccount.accountType,
      debit: 0,
      credit: totalCOGSFromTechStock,
      description: `From technician stock (trunk stock sales)`,
    });
  }

  // Create journal entry (with tenant scoping)
  const journalEntry = await JournalEntry.create({
    companyId: this.companyId, // Tenant scoping
    entryNumber,
    entryDate: this.invoiceDate,
    entryType: "sale",
    description: `COGS - Invoice ${this.invoiceNumber}`,
    lines: journalLines,
    relatedDocuments: {
      invoiceId: this._id,
      invoiceNumber: this.invoiceNumber,
    },
    status: "draft",
    createdBy: user,
  });

  // Post journal entry
  await journalEntry.post(user);

  // Update stock movements with journal entry ID
  for (const movement of stockMovements) {
    movement.accounting.journalEntryId = journalEntry._id;
    movement.accounting.accountingPosted = true;
    movement.accounting.accountingPostedAt = new Date();
    await movement.save();
  }

  // ============================================
  // UPDATE STOCK REQUESTS (mark items as invoiced)
  // ============================================
  const StockRequest = mongoose.model("StockRequest");

  for (const { item } of itemsFromTechStock) {
    if (item.relatedRequest?.requestId) {
      const request = await StockRequest.findById(
        item.relatedRequest.requestId,
      );

      if (request) {
        // Find the matching item in the request
        const requestItem = request.items.find(
          (ri) => ri.productId.toString() === item.productId.toString(),
        );

        if (requestItem) {
          // Update invoicing tracking
          requestItem.invoicedQuantity =
            (requestItem.invoicedQuantity || 0) + item.quantity;
          requestItem.invoices.push({
            invoiceId: this._id,
            invoiceNumber: this.invoiceNumber,
            quantity: item.quantity,
            invoicedAt: new Date(),
          });
        }

        // Check if all items are fully invoiced
        const allInvoiced = request.items.every(
          (ri) => (ri.invoicedQuantity || 0) >= (ri.totalFulfilled || 0),
        );

        if (allInvoiced) {
          request.status = "invoiced";
        }

        await request.save();
      }
    }
  }

  return { journalEntry, stockMovements };
};

/**
 * Rollback completion (reverse journal entries, restore inventory)
 */
invoiceSchema.methods.rollbackCompletion = async function (
  user,
  { revenueJE, cogsJE, stockMovements },
) {
  const JournalEntry = mongoose.model("JournalEntry");
  const Product = mongoose.model("Product");
  const StockMovement = mongoose.model("StockMovement");

  try {
    // Reverse COGS journal entry
    if (cogsJE?._id) {
      const je = await JournalEntry.findById(cogsJE._id);
      if (je) {
        if (je.status === "posted") {
          await je.reverse(user, "Rollback: Invoice completion failed");
        } else {
          await JournalEntry.findByIdAndDelete(je._id);
        }
      }
    }

    // Reverse revenue journal entry
    if (revenueJE?._id) {
      const je = await JournalEntry.findById(revenueJE._id);
      if (je) {
        if (je.status === "posted") {
          await je.reverse(user, "Rollback: Invoice completion failed");
        } else {
          await JournalEntry.findByIdAndDelete(je._id);
        }
      }
    }

    // Restore inventory
    for (const movement of stockMovements) {
      const product = await Product.findById(movement.productId);
      if (product) {
        await product.increaseInventory(
          movement.quantity,
          movement.costing.unitCost,
          "Rollback: Invoice completion failed",
        );
      }
      await StockMovement.findByIdAndDelete(movement._id);
    }
  } catch (error) {
    console.error("[CRITICAL] Rollback failed:", error);
  }
};

/**
 * Generate unique entry number - delegates to centralized utility
 */
invoiceSchema.methods.generateUniqueEntryNumber = async function (
  prefix,
  session = null,
) {
  const { generateUniqueEntryNumber } =
    await import("@/lib/utils/server-utils");
  return generateUniqueEntryNumber(prefix, this.companyId, session);
};

/**
 * Record payment
 * @param {ObjectId|string} paymentId - The payment ID
 * @param {number} amount - Amount allocated to this invoice
 * @param {Object} paymentDetails - Optional payment details to avoid re-querying
 * @param {Date} paymentDetails.paymentDate
 * @param {string} paymentDetails.paymentNumber
 * @param {string} paymentDetails.paymentMethod
 * @param {ClientSession} session - Optional MongoDB session for transactions
 */
invoiceSchema.methods.recordPayment = async function (
  paymentId,
  amount,
  paymentDetails = null,
  session = null,
) {
  // Only completed invoices can accept payments
  if (this.status !== "completed") {
    throw new Error(
      `Can only record payments on completed invoices. Current status: ${this.status}`,
    );
  }

  if (amount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  if (amount > this.amountDue + 0.01) {
    throw new Error(
      `Payment amount (${amount}) exceeds amount due (${this.amountDue})`,
    );
  }

  // Use provided payment details or query for them
  let paymentDate, paymentNumber, paymentMethod;

  if (paymentDetails) {
    // Use provided details (avoids re-querying within transaction)
    paymentDate = paymentDetails.paymentDate;
    paymentNumber = paymentDetails.paymentNumber;
    paymentMethod = paymentDetails.paymentMethod;
  } else {
    // Fallback: query for payment (for backward compatibility)
    const Payment = mongoose.model("Payment");
    const payment = await Payment.findById(paymentId).session(session);

    if (!payment) {
      throw new Error(`Payment not found (ID: ${paymentId})`);
    }

    paymentDate = payment.paymentDate;
    paymentNumber = payment.paymentNumber;
    paymentMethod = payment.paymentMethod;
  }

  // Add to payment history
  this.paymentHistory.push({
    paymentId:
      typeof paymentId === "string"
        ? new mongoose.Types.ObjectId(paymentId)
        : paymentId,
    amount: amount,
    paymentDate: paymentDate,
    paymentNumber: paymentNumber,
    paymentMethod: paymentMethod,
  });

  // Update amounts
  this.amountPaid += amount;
  this.amountDue = this.total - this.amountPaid;

  if (Math.abs(this.amountDue) < 0.01) {
    this.amountDue = 0;
  }

  // Update payment status
  if (this.amountDue <= 0.01) {
    this.paymentStatus = "paid";
    // Note: status stays "completed" - we use paymentStatus to track payment state
  } else if (this.amountPaid > 0) {
    this.paymentStatus = "partial";
  }

  // Update related journal entry
  if (this.accounting?.revenueJournalEntryId) {
    const JournalEntry = mongoose.model("JournalEntry");
    const je = await JournalEntry.findById(
      this.accounting.revenueJournalEntryId,
    ).session(session);

    if (je) {
      je.amountPaid = this.amountPaid;
      je.amountOutstanding = this.amountDue;
      je.isFullyPaid = this.amountDue <= 0.01;
      await je.save({ session });
    }
  }

  await this.save({ session });
  return this;
};

/**
 * Cancel invoice
 */
invoiceSchema.methods.cancel = async function (cancelledBy, reason) {
  if (this.paymentStatus === "paid") {
    throw new Error(
      "Cannot cancel a fully paid invoice. Refund payments first.",
    );
  }

  if (this.status === "cancelled") {
    throw new Error("Invoice is already cancelled");
  }

  if (this.paymentHistory.length > 0) {
    throw new Error(
      "Cannot cancel an invoice with payment history. Please reverse payments first.",
    );
  }

  const userInfo = formatUserForAudit(cancelledBy);
  const JournalEntry = mongoose.model("JournalEntry");
  const Product = mongoose.model("Product");
  const StockMovement = mongoose.model("StockMovement");

  // ============================================
  // HANDLE BASED ON INVOICE STATUS
  // ============================================
  const ItemCheckout = mongoose.model("ItemCheckout");

  // Default return deadline: 7 days from cancellation
  const returnDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  if (this.status === "draft" || this.status === "sent") {
    // ============================================
    // DRAFT/SENT INVOICE: Release committed inventory
    // ============================================
    // For draft invoices, stock was only COMMITTED (reserved), not deducted
    // Release the commitment to make stock available again
    for (const item of this.items) {
      if (item.itemType !== "product" || !item.productId) continue;

      // Only release if stock was committed (store items, not technician stock)
      if (item.stockCommitted) {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: {
            "inventory.quantityCommitted": -item.quantity,
            "inventory.quantityAvailable": item.quantity,
          },
        });
      }

      // Flag technician stock items for return
      if (item.relatedCheckout?.checkoutId) {
        await ItemCheckout.findByIdAndUpdate(item.relatedCheckout.checkoutId, {
          "returnRequired.required": true,
          "returnRequired.reason": "invoice_cancelled",
          "returnRequired.requiredAt": new Date(),
          "returnRequired.requiredBy": userInfo,
          "returnRequired.failedInvoice": {
            invoiceId: this._id,
            invoiceNumber: this.invoiceNumber,
          },
          "returnRequired.returnDeadline": returnDeadline,
          // Reset status back to checked_out (was pending sale)
          status: "checked_out",
          // Clear sale conversion since it didn't complete
          "saleConversion.converted": false,
          "saleConversion.invoiceId": null,
          "saleConversion.invoiceNumber": null,
        });
      }
    }
  } else if (this.status === "expired") {
    // ============================================
    // EXPIRED INVOICE: Stock already released during expiry
    // ============================================
    // No inventory action needed - just update status to cancelled
  } else if (this.status === "completed") {
    // ============================================
    // COMPLETED INVOICE: Full reversal with journal entries
    // ============================================

    // Reverse revenue journal entry
    if (this.accounting?.revenueJournalEntryId) {
      const je = await JournalEntry.findById(
        this.accounting.revenueJournalEntryId,
      );
      if (je && je.status === "posted") {
        await je.reverse(userInfo, reason || "Invoice cancelled");
      }
    }

    // Reverse COGS journal entry
    if (this.accounting?.cogsJournalEntryId) {
      const je = await JournalEntry.findById(this.accounting.cogsJournalEntryId);
      if (je && je.status === "posted") {
        await je.reverse(userInfo, reason || "Invoice cancelled");
      }
    }

    // Restore inventory (reverse stock movements for direct sales)
    const stockMovements = await StockMovement.find({
      "relatedDocuments.invoiceId": this._id,
      movementType: "sale",
      direction: "out",
    });

    for (const movement of stockMovements) {
      const product = await Product.findById(movement.productId);
      if (product) {
        // Restore the inventory
        await product.increaseInventory(
          movement.quantity,
          movement.costing?.unitCost || 0,
          `Restored from cancelled invoice ${this.invoiceNumber}`,
        );

        // Reverse lifetime totals
        if (product.lifetimeTotals) {
          product.lifetimeTotals.totalQuantitySold =
            (product.lifetimeTotals.totalQuantitySold || 0) - movement.quantity;
          product.lifetimeTotals.totalRevenue =
            (product.lifetimeTotals.totalRevenue || 0) -
            (movement.costing?.totalValue || 0);
          product.lifetimeTotals.totalCOGS =
            (product.lifetimeTotals.totalCOGS || 0) -
            (movement.costing?.totalCost || 0);
          product.lifetimeTotals.totalGrossProfit =
            (product.lifetimeTotals.totalGrossProfit || 0) -
            ((movement.costing?.totalValue || 0) -
              (movement.costing?.totalCost || 0));
          await product.save();
        }
      }

      // Mark movement as reversed
      movement.status = "reversed";
      movement.reversedAt = new Date();
      movement.reversedBy = userInfo;
      movement.reversalReason = reason || "Invoice cancelled";
      await movement.save();
    }
  }

  // Update invoice status
  this.status = "cancelled";
  this.cancelledAt = new Date();
  this.cancelledBy = userInfo;
  this.cancellationReason = reason || "No reason provided";
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

// ============================================
// EXPIRE DRAFT INVOICE (Release committed stock)
// ============================================
invoiceSchema.methods.expire = async function (expiredBy = null) {
  if (this.status !== "draft" && this.status !== "sent") {
    throw new Error(
      `Can only expire draft or sent invoices. Current status: ${this.status}`,
    );
  }

  // Only expire if there's committed stock
  const hasCommittedStock = this.items.some((item) => item.stockCommitted === true);
  if (!hasCommittedStock) {
    throw new Error("Invoice has no committed stock to release");
  }

  const Product = mongoose.model("Product");
  const ItemCheckout = mongoose.model("ItemCheckout");
  const userInfo = expiredBy || { name: "System", id: "system" };

  // Default return deadline: 7 days from expiry
  const returnDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Release committed inventory for each product item
  for (const item of this.items) {
    if (item.itemType !== "product" || !item.productId) continue;

    if (item.stockCommitted) {
      // Store inventory item - release commitment
      await Product.findByIdAndUpdate(item.productId, {
        $inc: {
          "inventory.quantityCommitted": -item.quantity,
          "inventory.quantityAvailable": item.quantity,
        },
      });

      // Mark as no longer committed
      item.stockCommitted = false;
    }

    // Flag technician stock items for return
    if (item.relatedCheckout?.checkoutId) {
      await ItemCheckout.findByIdAndUpdate(item.relatedCheckout.checkoutId, {
        "returnRequired.required": true,
        "returnRequired.reason": "invoice_expired",
        "returnRequired.requiredAt": new Date(),
        "returnRequired.requiredBy": userInfo,
        "returnRequired.failedInvoice": {
          invoiceId: this._id,
          invoiceNumber: this.invoiceNumber,
        },
        "returnRequired.returnDeadline": returnDeadline,
        // Clear sale conversion since it didn't complete
        "saleConversion.converted": false,
        "saleConversion.invoiceId": null,
        "saleConversion.invoiceNumber": null,
      });
    }
  }

  // Update invoice status
  this.status = "expired";
  this.expiredAt = new Date();
  this.expiredBy = userInfo;
  this.draftExpiresAt = null; // Clear expiry so it doesn't trigger again
  this.lastModifiedBy = userInfo;

  await this.save();
  return this;
};

// ============================================
// STATIC METHODS
// ============================================

invoiceSchema.statics.getUnpaidInvoices = function (customerId = null) {
  const query = {
    paymentStatus: { $in: ["unpaid", "partial"] },
    status: "completed",
  };

  if (customerId) {
    query["customer.id"] = customerId;
  }

  return this.find(query).sort({ dueDate: 1 }).lean();
};

invoiceSchema.statics.getOverdueInvoices = function (customerId = null) {
  const query = {
    paymentStatus: { $in: ["unpaid", "partial"] },
    status: "completed",
    dueDate: { $lt: new Date() },
  };

  if (customerId) {
    query["customer.id"] = customerId;
  }

  return this.find(query).sort({ dueDate: 1 }).lean();
};

invoiceSchema.statics.getByCustomer = function (customerId) {
  return this.find({
    "customer.id": customerId,
    status: { $ne: "cancelled" },
  })
    .sort({ invoiceDate: -1 })
    .lean();
};

invoiceSchema.statics.getSalesReport = async function (startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        invoiceDate: { $gte: startDate, $lte: endDate },
        status: "completed", // Only completed invoices count for sales
      },
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$subtotal" },
        totalCOGS: { $sum: "$totalCOGS" },
        totalGrossProfit: { $sum: "$grossProfit" },
        totalTax: { $sum: "$taxAmount" },
        count: { $sum: 1 },
      },
    },
  ]);

  if (result.length === 0) {
    return {
      totalRevenue: 0,
      totalCOGS: 0,
      totalGrossProfit: 0,
      totalTax: 0,
      grossMargin: 0,
      count: 0,
    };
  }

  const data = result[0];
  return {
    totalRevenue: data.totalRevenue || 0,
    totalCOGS: data.totalCOGS || 0,
    totalGrossProfit: data.totalGrossProfit || 0,
    totalTax: data.totalTax || 0,
    grossMargin:
      data.totalRevenue > 0
        ? ((data.totalGrossProfit / data.totalRevenue) * 100).toFixed(2)
        : 0,
    count: data.count || 0,
  };
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Invoice = models?.Invoice;

if (!Invoice) {
  Invoice = mongoose.model("Invoice", invoiceSchema);
}

export default Invoice;

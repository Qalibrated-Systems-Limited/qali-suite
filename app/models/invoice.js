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

    // Customer Information
    // Sales attribution — stamped at creation (copied from the quote/SO/
    // opportunity owner), never recomputed, so per-rep reporting survives
    // staff changes. Mirrors Quote.salesPerson.
    salesPerson: {
      employeeId: { type: Schema.Types.ObjectId, ref: "User", index: true },
      partyId: { type: Schema.Types.ObjectId, ref: "Party" },
      name: String,
      commission: {
        rate: { type: Number, default: 0 },
        amount: { type: Number, default: 0 },
      },
    },

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

          // Weighbridge fulfillment — set by the WB connector when the outbound
          // ticket completes and this item's inventory has already been moved.
          // When true, invoice posting MUST skip inventory reduction and COGS JE
          // for this item — WB already posted: DR COGS, CR Inventory.
          // Invoice only needs to post the revenue side: DR AR, CR Revenue.
          weighbridgeTicketId: {
            type: Schema.Types.ObjectId,
            ref: "WeighbridgeTicket",
            default: null,
          },
          weighbridgeTicketNumber: {
            type: String,
            default: null,
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

    title: {
      type: String,
      maxlength: 200,
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
invoiceSchema.index({ companyId: 1, "salesPerson.employeeId": 1, status: 1, invoiceDate: -1 });
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

  // Batch fetch all products in one query
  const productIds = this.items
    .filter((item) => item.itemType === "product" && item.productId)
    .map((item) => item.productId);

  const products = productIds.length > 0
    ? await Product.find({ _id: { $in: productIds } }).lean()
    : [];
  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  for (const item of this.items) {
    if (item.itemType === "product" && item.productId) {
      const product = productMap.get(item.productId.toString());

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
invoiceSchema.methods.complete = async function (completedBy, externalSession = null) {
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

  // ==========================================
  // ATOMIC COMPLETION — every write below (revenue JE, COGS JE, stock
  // decrements, movements, VAT transaction, the invoice itself) commits
  // together or not at all. A crash mid-way can no longer leave revenue
  // posted without COGS, or stock moved without books. Replaces the old
  // compensating rollbackCompletion(), which could itself fail half-way.
  // ==========================================
  const ownSession = externalSession ? null : await mongoose.startSession();
  const session = externalSession || ownSession;

  try {
    const run = async () => {
      // withTransaction RETRIES this callback on transient errors, but the
      // in-memory mutations below survive the abort — reset them so a
      // retry doesn't trip the "journal entry already exists" guards.
      this.accounting = this.accounting || {};
      this.accounting.revenueJournalEntryId = undefined;
      this.accounting.cogsJournalEntryId = undefined;
      this.accounting.accountingComplete = false;

      // 1. Revenue journal entry (AR / Revenue / VAT Output)
      const revenueJE = await this.createRevenueJournalEntry(userInfo, session);
      this.accounting.revenueJournalEntryId = revenueJE._id;

      // 2. COGS journal entry + atomic stock fulfilment + movements
      if (this.hasProducts) {
        const result = await this.createCOGSJournalEntry(userInfo, session);
        if (result.journalEntry?._id) {
          this.accounting.cogsJournalEntryId = result.journalEntry._id;
        }
      }

      // 3. Status
      this.status = "completed";
      this.completedAt = new Date();
      this.completedBy = userInfo;
      this.lastModifiedBy = userInfo;
      this.accounting.accountingComplete = true;
      this.accounting.accountingCompletedAt = new Date();

      // 4. VAT Output tax transaction
      if (this.taxAmount > 0) {
        const TaxTransaction = mongoose.model("TaxTransaction");
        await TaxTransaction.createFromInvoice(this, userInfo, session);
      }

      await this.save({ session });
    };

    if (ownSession) {
      await ownSession.withTransaction(run);
    } else {
      await run();
    }

    return this;
  } catch (error) {
    throw new Error(`Invoice completion failed: ${error.message}`);
  } finally {
    if (ownSession) ownSession.endSession();
  }
};

/**
 * Create revenue journal entry (AR + Revenue + VAT Output)
 */
invoiceSchema.methods.createRevenueJournalEntry = async function (user, session = null) {
  if (this.accounting?.revenueJournalEntryId) {
    throw new Error("Revenue journal entry already exists");
  }

  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  // Get accounts (tenant-scoped) - fetch in parallel
  const [arAccount, revenueAccount, vatOutputAccount] = await Promise.all([
    Account.findOne({ companyId: this.companyId, systemAccount: "accounts_receivable" }),
    Account.findOne({ companyId: this.companyId, systemAccount: "sales_revenue" }),
    Account.findOne({ companyId: this.companyId, systemAccount: "vat_output" }),
  ]);

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
  const [journalEntry] = await JournalEntry.create([{
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
  }], session ? { session } : {});

  // Post journal entry
  await journalEntry.post(user, session);

  return journalEntry;
};

/**
 * Create COGS journal entry + stock movements (COGS + Inventory reduction)
 */
invoiceSchema.methods.createCOGSJournalEntry = async function (user, session = null) {
  if (this.accounting?.cogsJournalEntryId) {
    throw new Error("COGS journal entry already exists");
  }

  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");
  const Product = mongoose.model("Product");
  const StockMovement = mongoose.model("StockMovement");

  // Get accounts - fetch in parallel (tenant-scoped)
  const [cogsAccount, inventoryAccount, technicianStockAccount] = await Promise.all([
    Account.findOne({ companyId: this.companyId, systemAccount: "cogs" }),
    Account.findOne({ companyId: this.companyId, systemAccount: "inventory" }),
    Account.findOne({ companyId: this.companyId, systemAccount: "technician_stock" }),
  ]);

  if (!cogsAccount) {
    throw new Error("COGS account not configured for this company");
  }

  // ============================================
  // PRE-FETCH ALL PRODUCTS IN ONE QUERY
  // ============================================
  const productIds = this.items
    .filter((item) => item.itemType === "product" && item.productId)
    .map((item) => item.productId);

  const products = productIds.length > 0
    ? await Product.find({ _id: { $in: productIds } }).session(session)
    : [];
  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  // Separate items by source
  let totalCOGSFromInventory = 0; // Direct sales
  let totalCOGSFromTechStock = 0; // Sales from technician requests
  const stockMovements = [];
  const itemsFromInventory = [];
  const itemsFromTechStock = [];

  for (const item of this.items) {
    if (item.itemType !== "product" || !item.productId) continue;

    const product = productMap.get(item.productId.toString());

    if (!product) {
      throw new Error(`Product not found: ${item.productId}`);
    }

    // Check if item is from technician stock (either via request or direct checkout)
    const isFromTechnicianStock = !!(item.relatedRequest?.requestId || item.relatedCheckout?.checkoutId);

    // Check if inventory was already moved by the weighbridge connector.
    // When true: WB already posted DR COGS / CR Inventory.
    // Invoice posting must skip inventory + COGS for this item — only post revenue.
    const isWBFulfilled = !!item.weighbridgeTicketId;

    // Check if stock was pre-committed (new commitment-based flow)
    const isStockCommitted = item.stockCommitted === true;

    const lineCOGS = item.quantity * (product.costing?.costPrice || 0);

    // Categorize by source
    if (isFromTechnicianStock) {
      totalCOGSFromTechStock += lineCOGS;
      itemsFromTechStock.push({ item, product, lineCOGS });
    } else if (isWBFulfilled) {
      // WB-fulfilled items: inventory and COGS already handled by the WB connector.
      // Do not add to itemsFromInventory — they won't get another stock movement or COGS JE.
    } else {
      totalCOGSFromInventory += lineCOGS;
      itemsFromInventory.push({ item, product, lineCOGS });
    }

    // ============================================
    // FULFILL INVENTORY — ATOMIC. The old read-modify-write (hydrate,
    // mutate, save) let two concurrent completions both read qty=100 and
    // both write 90: overselling. Now the availability check lives in the
    // UPDATE FILTER ($gte guard) — only one concurrent completion can win
    // the last units; the loser aborts the whole transaction.
    // ============================================
    const lifetimeInc = {
      "lifetimeTotals.totalQuantitySold": item.quantity,
      "lifetimeTotals.totalRevenue": item.amount,
      "lifetimeTotals.totalCOGS": lineCOGS,
      "lifetimeTotals.totalGrossProfit": item.amount - lineCOGS,
    };

    if (!isFromTechnicianStock && !isWBFulfilled) {
      const guard = isStockCommitted
        ? { "inventory.quantityOnHand": { $gte: item.quantity } }
        : { "inventory.quantityAvailable": { $gte: item.quantity } };
      const stockInc = isStockCommitted
        ? {
            "inventory.quantityOnHand": -item.quantity,
            "inventory.quantityCommitted": -item.quantity,
          }
        : {
            "inventory.quantityOnHand": -item.quantity,
            "inventory.quantityAvailable": -item.quantity,
          };

      const updated = await Product.findOneAndUpdate(
        { _id: product._id, ...guard },
        { $inc: { ...stockInc, ...lifetimeInc } },
        { new: true, session },
      );

      if (!updated) {
        const fresh = await Product.findById(product._id)
          .select("name inventory")
          .session(session)
          .lean();
        throw new Error(
          isStockCommitted
            ? `Insufficient physical stock for ${product.name}. On-hand: ${fresh?.inventory?.quantityOnHand ?? 0}, Committed: ${item.quantity}`
            : `Insufficient stock for ${product.name}. Available: ${fresh?.inventory?.quantityAvailable ?? 0}, Requested: ${item.quantity}`,
        );
      }

      // Movements record the post-update stock level.
      item._newStock = updated.inventory?.quantityOnHand ?? 0;
    } else {
      // Tech-stock / WB-fulfilled items: no store-stock change, but
      // lifetime totals still accrue.
      await Product.updateOne(
        { _id: product._id },
        { $inc: lifetimeInc },
        { session },
      );
    }
  }

  // ============================================
  // CREATE STOCK MOVEMENTS (only for direct sales from inventory)
  // ============================================
  // Generate all movement numbers first (sequential - atomic counter)
  const movementNumbers = [];
  for (let i = 0; i < itemsFromInventory.length; i++) {
    movementNumbers.push(await StockMovement.generateMovementNumber(this.companyId));
  }

  // Create all movements in parallel (inside the transaction)
  const createdMovements = await Promise.all(
    itemsFromInventory.map(({ item, product, lineCOGS }, idx) =>
      StockMovement.create([{
        companyId: this.companyId,
        movementNumber: movementNumbers[idx],
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
        // _newStock captured from the atomic decrement above
        previousStock: (item._newStock ?? 0) + item.quantity,
        newStock: item._newStock ?? 0,
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
      }], session ? { session } : {}).then((r) => r[0])
    )
  );
  stockMovements.push(...createdMovements);

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
  const [journalEntry] = await JournalEntry.create([{
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
  }], session ? { session } : {});

  // Post journal entry
  await journalEntry.post(user, session);

  // Update stock movements with journal entry ID (parallel)
  await Promise.all(
    stockMovements.map((movement) => {
      movement.accounting.journalEntryId = journalEntry._id;
      movement.accounting.accountingPosted = true;
      movement.accounting.accountingPostedAt = new Date();
      return movement.save({ session });
    })
  );

  // ============================================
  // UPDATE STOCK REQUESTS (mark items as invoiced)
  // ============================================
  const StockRequest = mongoose.model("StockRequest");

  // Group tech stock items by requestId to avoid fetching same request multiple times
  const requestUpdates = new Map();
  for (const { item } of itemsFromTechStock) {
    if (item.relatedRequest?.requestId) {
      const reqId = item.relatedRequest.requestId.toString();
      if (!requestUpdates.has(reqId)) {
        requestUpdates.set(reqId, []);
      }
      requestUpdates.get(reqId).push(item);
    }
  }

  // Fetch all requests in parallel, then update and save in parallel
  const requestIds = Array.from(requestUpdates.keys());
  if (requestIds.length > 0) {
    const requests = await StockRequest.find({ _id: { $in: requestIds } }).session(session);

    for (const request of requests) {
      const items = requestUpdates.get(request._id.toString()) || [];
      for (const item of items) {
        const requestItem = request.items.find(
          (ri) => ri.productId.toString() === item.productId.toString(),
        );
        if (requestItem) {
          requestItem.invoicedQuantity =
            (requestItem.invoicedQuantity || 0) + item.quantity;
          requestItem.invoices.push({
            invoiceId: this._id,
            invoiceNumber: this.invoiceNumber,
            quantity: item.quantity,
            invoicedAt: new Date(),
          });
        }
      }

      const allInvoiced = request.items.every(
        (ri) => (ri.invoicedQuantity || 0) >= (ri.totalFulfilled || 0),
      );
      if (allInvoiced) {
        request.status = "invoiced";
      }
    }

    await Promise.all(requests.map((r) => r.save({ session })));
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

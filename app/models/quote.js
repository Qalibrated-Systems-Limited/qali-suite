import mongoose from "mongoose";
import { formatAddress } from "../../lib/format-address";

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
// QUOTE/QUOTATION SCHEMA
// ============================================
// Design Principles:
// 1. Quote is a proposal document - no accounting entries
// 2. Can be converted to Invoice (full or partial)
// 3. Links to Invoices for traceability
// 4. Immutable customer snapshot at creation
// 5. Flexible - Invoices can be created without Quote
// 6. Expiration tracking with auto-expire
// ============================================

const quoteLineSchema = new Schema(
  {
    lineNumber: {
      type: Number,
      required: true,
      min: 1,
    },

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
        "labor",
        "mileage",
        "accommodation",
        "installation",
        "consultation",
        "maintenance",
        "repair",
        "other",
      ],
    },

    // Product Reference (for products only)
    product: {
      id: { type: Schema.Types.ObjectId, ref: "Product" },
      sku: { type: String, uppercase: true, trim: true },
      name: String,
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: 500,
    },

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
    taxRate: {
      type: Number,
      default: 16, // Kenya VAT
      min: 0,
      max: 100,
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Discount
    discountPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Line total after discount and tax
    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    // ==========================================
    // INVOICING TRACKING
    // ==========================================
    invoicedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Invoicing history
    invoices: [
      {
        invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
        invoiceNumber: String,
        quantity: Number,
        invoicedAt: Date,
        invoicedBy: { name: String, id: String },
      },
    ],

    // Optional: Related stock request (for technician quotes)
    relatedRequest: {
      requestId: { type: Schema.Types.ObjectId, ref: "StockRequest" },
      requestNumber: String,
      technicianId: String,
      technicianName: String,
    },
  },
  { _id: true },
);

// Virtual: remaining quantity to invoice
quoteLineSchema.virtual("remainingQuantity").get(function () {
  return this.quantity - this.invoicedQuantity;
});

quoteLineSchema.virtual("isFullyInvoiced").get(function () {
  return this.invoicedQuantity >= this.quantity;
});

// ============================================
// MAIN QUOTE SCHEMA
// ============================================
const quoteSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // ==========================================
    // IDENTIFICATION
    // ==========================================
    quoteNumber: {
      type: String,
      required: [true, "Quote number is required"],
      uppercase: true,
      trim: true,
    },

    // ==========================================
    // DATES
    // ==========================================
    quoteDate: {
      type: Date,
      required: [true, "Quote date is required"],
      index: true,
    },

    validUntil: {
      type: Date,
      required: [true, "Valid until date is required"],
      index: true,
    },

    // ==========================================
    // CUSTOMER (Snapshot - immutable after creation)
    // ==========================================
    customer: {
      partyId: {
        type: Schema.Types.ObjectId,
        ref: "Party",
        index: true,
      },
      // Support both party reference and direct ID (for backward compatibility)
      id: {
        type: String,
        index: true,
      },
      name: { type: String, required: true, trim: true },
      email: { type: String, lowercase: true, trim: true },
      phone: { type: String, trim: true },
      address: String,
      taxPin: { type: String, uppercase: true, trim: true },
    },

    // ==========================================
    // SALES PERSON (optional)
    // ==========================================
    salesPerson: {
      partyId: { type: Schema.Types.ObjectId, ref: "Party" },
      employeeId: { type: Schema.Types.ObjectId, ref: "User" },
      name: String,
      employeeNumber: String,
      commission: {
        rate: { type: Number, default: 0 },
        amount: { type: Number, default: 0 },
      },
    },

    // ==========================================
    // LINE ITEMS (max 50 lines)
    // ==========================================
    items: {
      type: [quoteLineSchema],
      validate: [
        {
          validator: function (items) {
            return items && items.length > 0;
          },
          message: "Quote must have at least one item",
        },
        {
          validator: function (items) {
            return items.length <= 50;
          },
          message: "Quote cannot have more than 50 items",
        },
      ],
    },

    // ==========================================
    // AMOUNTS
    // ==========================================
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    totalDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    total: {
      type: Number,
      required: true,
      min: 0,
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
      enum: [
        "draft",
        "sent",
        "accepted",
        "rejected",
        "expired",
        "converted",
        "cancelled",
      ],
      default: "draft",
      index: true,
    },

    // ==========================================
    // WORKFLOW TIMESTAMPS
    // ==========================================
    sentAt: Date,
    sentBy: { name: String, id: String },

    // Email-delivery tracking. `sentAt` = the user clicked "send"; these
    // record what happened with the actual outbound email.
    sentTo: String,                   // Customer email address used
    deliveredAt: Date,                // Resend confirmed accepted-for-delivery
    deliveryAttempts: { type: Number, default: 0 },
    lastDeliveryError: String,        // Surfaced on the quote detail page if non-empty

    acceptedAt: Date,
    acceptedBy: { name: String, id: String },

    rejectedAt: Date,
    rejectedBy: { name: String, id: String },
    rejectionReason: String,

    cancelledAt: Date,
    cancelledBy: { name: String, id: String },
    cancellationReason: String,

    // ==========================================
    // INVOICE REFERENCES (Invoices created from this Quote)
    // ==========================================
    invoices: [
      {
        invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
        invoiceNumber: String,
        amount: Number,
        createdAt: Date,
        createdBy: { name: String, id: String },
      },
    ],

    // ==========================================
    // TITLE & REFERENCE
    // ==========================================
    title: {
      type: String,
      maxlength: 200,
    },

    reference: {
      type: String,
      trim: true,
    },

    // ==========================================
    // NOTES & TERMS
    // ==========================================
    notes: {
      type: String,
      maxlength: 2000,
    },

    termsAndConditions: {
      type: String,
      maxlength: 5000,
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
// Unique quote number per company
quoteSchema.index({ companyId: 1, quoteNumber: 1 }, { unique: true });
// Query indexes - all prefixed with companyId for tenant isolation
quoteSchema.index({ companyId: 1, quoteDate: -1, status: 1 });
quoteSchema.index({ companyId: 1, "customer.partyId": 1, status: 1 });
quoteSchema.index({ companyId: 1, "customer.id": 1, status: 1 });
quoteSchema.index({ companyId: 1, validUntil: 1, status: 1 });
quoteSchema.index({ companyId: 1, "salesPerson.employeeId": 1, status: 1 });

// ============================================
// VIRTUALS
// ============================================
quoteSchema.virtual("isExpired").get(function () {
  if (["converted", "cancelled", "rejected", "expired"].includes(this.status)) {
    return false;
  }
  return new Date() > this.validUntil;
});

quoteSchema.virtual("daysUntilExpiry").get(function () {
  if (this.isExpired) return 0;
  const diff = this.validUntil - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

quoteSchema.virtual("totalInvoiced").get(function () {
  return this.items.reduce((sum, item) => sum + item.invoicedQuantity, 0);
});

quoteSchema.virtual("totalItems").get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

quoteSchema.virtual("invoicingPercentage").get(function () {
  const total = this.totalItems;
  if (total === 0) return 0;
  return Math.round((this.totalInvoiced / total) * 100);
});

quoteSchema.virtual("isFullyInvoiced").get(function () {
  return this.items.every((item) => item.invoicedQuantity >= item.quantity);
});

quoteSchema.virtual("canEdit").get(function () {
  return this.status === "draft";
});

quoteSchema.virtual("canSend").get(function () {
  return this.status === "draft";
});

quoteSchema.virtual("canAccept").get(function () {
  return this.status === "sent" && !this.isExpired;
});

quoteSchema.virtual("canReject").get(function () {
  return this.status === "sent";
});

quoteSchema.virtual("canConvertToInvoice").get(function () {
  return ["sent", "accepted"].includes(this.status) && !this.isExpired;
});

quoteSchema.virtual("canCancel").get(function () {
  // Can't cancel if any invoices created
  if (this.invoices && this.invoices.length > 0) return false;
  return ["draft", "sent"].includes(this.status);
});

quoteSchema.virtual("lineCount").get(function () {
  return this.items?.length || 0;
});

// ============================================
// PRE-SAVE: Calculate amounts
// ============================================
quoteSchema.pre("save", function (next) {
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;

  this.items.forEach((item, index) => {
    item.lineNumber = index + 1;

    // Calculate amount before discount
    const grossAmount = Math.round(item.quantity * item.unitPrice * 100) / 100;

    // Calculate discount
    if (item.discountPercentage > 0) {
      item.discountAmount =
        Math.round(grossAmount * (item.discountPercentage / 100) * 100) / 100;
    }

    // Amount after discount
    item.amount = grossAmount - item.discountAmount;

    // Calculate tax on discounted amount
    item.taxAmount = Math.round(item.amount * (item.taxRate / 100) * 100) / 100;

    // Line total
    item.lineTotal = item.amount + item.taxAmount;

    subtotal += item.amount;
    totalDiscount += item.discountAmount;
    totalTax += item.taxAmount;
  });

  this.subtotal = Math.round(subtotal * 100) / 100;
  this.totalDiscount = Math.round(totalDiscount * 100) / 100;
  this.taxAmount = Math.round(totalTax * 100) / 100;
  this.total = this.subtotal + this.taxAmount;

  // Calculate sales commission if applicable
  if (this.salesPerson?.commission?.rate > 0) {
    this.salesPerson.commission.amount =
      Math.round(
        this.subtotal * (this.salesPerson.commission.rate / 100) * 100,
      ) / 100;
  }

  // Check for expiration
  if (
    this.validUntil &&
    new Date() > this.validUntil &&
    !["converted", "cancelled", "rejected", "expired"].includes(this.status)
  ) {
    this.status = "expired";
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
// METHOD: Send to Customer
// ============================================
quoteSchema.methods.send = async function (user) {
  if (!this.canSend) {
    throw new Error(`Cannot send quote in status: ${this.status}`);
  }

  const userInfo = formatUser(user);

  this.status = "sent";
  this.sentAt = new Date();
  this.sentBy = userInfo;
  this.lastModifiedBy = userInfo;

  await this.save();
  return this;
};

// ============================================
// METHOD: Accept (Customer accepted)
// ============================================
quoteSchema.methods.accept = async function (user) {
  if (!this.canAccept) {
    throw new Error(`Cannot accept quote in status: ${this.status}`);
  }

  const userInfo = formatUser(user);

  this.status = "accepted";
  this.acceptedAt = new Date();
  this.acceptedBy = userInfo;
  this.lastModifiedBy = userInfo;

  await this.save();
  return this;
};

// ============================================
// METHOD: Reject
// ============================================
quoteSchema.methods.reject = async function (user, reason) {
  if (!this.canReject) {
    throw new Error(`Cannot reject quote in status: ${this.status}`);
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
quoteSchema.methods.cancel = async function (user, reason) {
  if (!this.canCancel) {
    throw new Error(`Cannot cancel quote in status: ${this.status}`);
  }

  const userInfo = formatUser(user);

  this.status = "cancelled";
  this.cancelledAt = new Date();
  this.cancelledBy = userInfo;
  this.cancellationReason = reason || "No reason provided";
  this.lastModifiedBy = userInfo;

  await this.save();
  return this;
};

// ============================================
// METHOD: Record Invoicing (when Invoice is created)
// ============================================
quoteSchema.methods.recordInvoicing = async function (
  invoiceId,
  invoiceNumber,
  invoicedItems,
  user,
) {
  const userInfo = formatUser(user);

  for (const invoiced of invoicedItems) {
    const item = this.items.find(
      (i) =>
        i._id.toString() === invoiced.lineId ||
        (i.product?.id &&
          i.product.id.toString() === invoiced.productId?.toString()),
    );

    if (item) {
      item.invoicedQuantity += invoiced.quantity;
      item.invoices.push({
        invoiceId,
        invoiceNumber,
        quantity: invoiced.quantity,
        invoicedAt: new Date(),
        invoicedBy: userInfo,
      });
    }
  }

  // Add invoice reference
  this.invoices.push({
    invoiceId,
    invoiceNumber,
    amount: invoicedItems.reduce((sum, item) => sum + (item.amount || 0), 0),
    createdAt: new Date(),
    createdBy: userInfo,
  });

  // Update status based on invoicing
  if (this.isFullyInvoiced) {
    this.status = "converted";
  }

  this.lastModifiedBy = userInfo;
  await this.save();
  return this;
};

// ============================================
// METHOD: Get items available for invoicing
// ============================================
quoteSchema.methods.getAvailableItems = function () {
  return this.items
    .filter((item) => item.invoicedQuantity < item.quantity)
    .map((item) => ({
      lineId: item._id,
      itemType: item.itemType,
      product: item.product,
      description: item.description,
      unit: item.unit,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate,
      discountPercentage: item.discountPercentage,
      quotedQuantity: item.quantity,
      invoicedQuantity: item.invoicedQuantity,
      availableQuantity: item.quantity - item.invoicedQuantity,
      relatedRequest: item.relatedRequest,
    }));
};

// ============================================
// METHOD: Convert to Invoice
// ============================================
quoteSchema.methods.convertToInvoice = async function (
  selectedItems,
  invoiceData,
  user,
) {
  if (!this.canConvertToInvoice) {
    throw new Error(
      `Cannot convert quote to invoice in status: ${this.status}`,
    );
  }

  const Invoice = mongoose.model("Invoice");
  const userInfo = formatUser(user);

  // Build invoice items from selected quote items
  const invoiceItems = [];
  const invoicedItems = [];

  for (const selection of selectedItems) {
    const quoteItem = this.items.find(
      (i) => i._id.toString() === selection.lineId.toString(),
    );

    if (!quoteItem) {
      throw new Error(`Quote item not found: ${selection.lineId}`);
    }

    const availableQty = quoteItem.quantity - quoteItem.invoicedQuantity;
    if (selection.quantity > availableQty) {
      throw new Error(
        `Quantity ${selection.quantity} exceeds available ${availableQty} for item ${quoteItem.description}`,
      );
    }

    // Calculate amounts
    const grossAmount =
      Math.round(selection.quantity * quoteItem.unitPrice * 100) / 100;
    const discountAmount =
      Math.round(grossAmount * (quoteItem.discountPercentage / 100) * 100) /
      100;
    const amount = grossAmount - discountAmount;
    const taxAmount =
      Math.round(amount * (quoteItem.taxRate / 100) * 100) / 100;

    invoiceItems.push({
      itemType: quoteItem.itemType,
      productId: quoteItem.product?.id,
      productSKU: quoteItem.product?.sku,
      productName: quoteItem.product?.name,
      description: quoteItem.description,
      unit: quoteItem.unit,
      quantity: selection.quantity,
      unitPrice: quoteItem.unitPrice,
      amount,
      taxRate: quoteItem.taxRate,
      taxAmount,
      discountPercentage: quoteItem.discountPercentage,
      discountAmount,
      relatedRequest: quoteItem.relatedRequest,
    });

    invoicedItems.push({
      lineId: quoteItem._id.toString(),
      productId: quoteItem.product?.id,
      quantity: selection.quantity,
      amount: amount + taxAmount,
    });
  }

  // Generate invoice number
  const { generateInvoiceNumber } =
    await import("@/app/mongodb/queries/invoice-queries");
  const invoiceNumber = await generateInvoiceNumber(this.companyId);

  // Create invoice
  const invoiceDate = invoiceData.invoiceDate || new Date();
  const dueDate =
    invoiceData.dueDate ||
    new Date(invoiceDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Calculate totals
  const subtotal = invoiceItems.reduce((sum, item) => sum + item.amount, 0);
  const totalDiscount = invoiceItems.reduce(
    (sum, item) => sum + item.discountAmount,
    0,
  );
  const taxAmount = invoiceItems.reduce((sum, item) => sum + item.taxAmount, 0);
  const total = subtotal + taxAmount;

  const invoice = new Invoice({
    companyId: this.companyId,
    invoiceNumber,
    invoiceDate,
    dueDate,
    customer: {
      id: this.customer.id || this.customer.partyId?.toString(),
      name: this.customer.name,
      email: this.customer.email,
      phone: this.customer.phone,
      address: formatAddress(this.customer.address),
      taxPin: this.customer.taxPin,
    },
    items: invoiceItems,
    subtotal,
    totalDiscount,
    taxRate: invoiceData.vatPercentage || 16,
    taxAmount,
    total,
    amountDue: total,
    amountPaid: 0,
    paymentStatus: "unpaid",
    status: "draft",
    quoteRef: {
      quoteId: this._id,
      quoteNumber: this.quoteNumber,
    },
    salesPerson: this.salesPerson?.employeeId || this.salesPerson?.name
      ? this.salesPerson
      : undefined,
    notes: invoiceData.notes || this.notes,
    createdBy: userInfo,
  });

  await invoice.save();

  // Update quote with invoicing information
  await this.recordInvoicing(invoice._id, invoiceNumber, invoicedItems, user);

  return invoice;
};

// ============================================
// STATIC: Generate Quote Number with Company Code Prefix
// ============================================
quoteSchema.statics.generateQuoteNumber = async function (companyId = null, session = null) {
  const ErpCounter = mongoose.model("ErpCounter");
  const Company = mongoose.model("Company");
  const date = new Date();
  const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;

  // Fetch company code for prefix
  let companyCode = null;
  if (companyId) {
    let companyQuery = Company.findById(companyId).select("code name").lean();
    if (session) companyQuery = companyQuery.session(session);
    const company = await companyQuery;
    if (company) {
      // Use explicit code if set, otherwise derive from company name
      companyCode = company.code || deriveCompanyCode(company.name);
    }
  }

  // Build prefix: QT-{CODE}-{YYYYMM} or QT-{YYYYMM}
  const prefix = companyCode ? `QT-${companyCode}-${yearMonth}` : `QT-${yearMonth}`;

  // Build counter ID with company code for tenant isolation
  const counterId = companyCode
    ? `quote-${companyCode.toLowerCase()}-${yearMonth}`
    : `quote-${yearMonth}`;

  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const seq = await ErpCounter.getNextSequence(counterId, session);
      const quoteNumber = `${prefix}-${String(seq).padStart(4, "0")}`;

      // Use .session() method chaining to avoid ClientSession serialization error
      let existsQuery = this.exists({ quoteNumber });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;

      if (!exists) {
        return quoteNumber;
      }

      console.warn(`Quote number ${quoteNumber} already exists, retrying...`);
      continue;
    } catch (counterError) {
      console.warn(
        `Counter failed for ${counterId}, attempt ${attempt + 1}:`,
        counterError.message,
      );

      // Fallback: find last quote number and increment
      let lastQuoteQuery = this.findOne({ quoteNumber: { $regex: `^${prefix}` } })
        .sort({ quoteNumber: -1 })
        .lean();
      if (session) lastQuoteQuery = lastQuoteQuery.session(session);
      const lastQuote = await lastQuoteQuery;

      let nextNum = 1;
      if (lastQuote?.quoteNumber) {
        const match = lastQuote.quoteNumber.match(/(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }

      const quoteNumber = `${prefix}-${String(nextNum).padStart(4, "0")}`;

      let existsQuery = this.exists({ quoteNumber });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;

      if (!exists) {
        return quoteNumber;
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 50 * Math.pow(2, attempt)),
    );
  }

  // Ultimate fallback with timestamp
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 4).toUpperCase();
  return `${prefix}-${timestamp}${random}`;
};

// ============================================
// STATIC: Get by Customer
// ============================================
quoteSchema.statics.getByCustomer = function (customerId, status = null) {
  const query = {
    $or: [{ "customer.partyId": customerId }, { "customer.id": customerId }],
  };
  if (status) {
    query.status = Array.isArray(status) ? { $in: status } : status;
  }
  return this.find(query).sort({ quoteDate: -1 });
};

// ============================================
// STATIC: Get Active Quotes (for conversion)
// ============================================
quoteSchema.statics.getActiveQuotes = function () {
  return this.find({
    status: { $in: ["sent", "accepted"] },
    validUntil: { $gte: new Date() },
  }).sort({ validUntil: 1, quoteDate: -1 });
};

// ============================================
// STATIC: Get Quotes with available items
// ============================================
quoteSchema.statics.getQuotesWithAvailableItems = async function (
  customerId = null,
) {
  const query = {
    status: { $in: ["sent", "accepted"] },
    validUntil: { $gte: new Date() },
  };

  if (customerId) {
    query.$or = [
      { "customer.partyId": customerId },
      { "customer.id": customerId },
    ];
  }

  const quotes = await this.find(query).sort({ quoteDate: -1 }).lean();

  // Filter to only quotes with available items
  return quotes
    .map((quote) => ({
      ...quote,
      availableItems: quote.items.filter(
        (item) => item.invoicedQuantity < item.quantity,
      ),
    }))
    .filter((quote) => quote.availableItems.length > 0);
};

// ============================================
// STATIC: Get Expiring Soon
// ============================================
quoteSchema.statics.getExpiringSoon = function (daysAhead = 7) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);

  return this.find({
    status: { $in: ["draft", "sent"] },
    validUntil: { $gte: new Date(), $lte: futureDate },
  }).sort({ validUntil: 1 });
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Quote = models?.Quote;

if (!Quote) {
  Quote = mongoose.model("Quote", quoteSchema);
}

export default Quote;

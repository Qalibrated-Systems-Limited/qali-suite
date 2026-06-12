import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// SALES ORDER SCHEMA
// ============================================
// The confirmed-commitment document between Quote and Invoice:
//
//   Quote (offer) → SalesOrder (customer said YES) → Invoice (bill)
//
// What it adds over going quote→invoice directly:
//  - RESERVATION: confirming an SO commits stock (Product.quantityCommitted,
//    same atomic $gte mechanism draft invoices use) so confirmed orders
//    can't be double-sold while awaiting fulfilment/billing.
//  - BACKLOG: the sum of confirmed-not-yet-invoiced orders is the order
//    backlog — revenue that is committed but not yet billed.
//
// Lifecycle (slice 1 — fulfilment/partial delivery is a later phase):
//   draft      — editable, NO stock impact
//   confirmed  — stock committed per product line (stockCommitted=true)
//   invoiced   — handed off to a draft Invoice; the commitment bookkeeping
//                TRANSFERS to the invoice lines (flags flip, the Product
//                counters are untouched — the invoice's complete() later
//                decrements onHand+committed exactly as it does today)
//   cancelled  — terminal; releases any commitment still held
//
// Commitment ownership rule: at any moment EXACTLY ONE document line owns
// a given committed quantity — the SO line while confirmed, the invoice
// line after conversion. That is what prevents double-commit / double-release.

export const SALES_ORDER_STATUSES = [
  "draft",
  "confirmed",
  "invoiced",
  "cancelled",
];

const salesOrderLineSchema = new Schema(
  {
    lineNumber: { type: Number, required: true, min: 1 },

    itemType: {
      type: String,
      enum: ["product", "service"],
      required: true,
    },

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
    unit: { type: String, default: "pcs", trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, default: 16, min: 0, max: 100 },
    taxAmount: { type: Number, default: 0, min: 0 },
    discountPercentage: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },

    // True while THIS line owns a reservation on Product.quantityCommitted.
    // Set on confirm, cleared on cancel (with release) or on conversion
    // (ownership transfers to the invoice line — no Product write).
    stockCommitted: { type: Boolean, default: false },

    // How much of this line has been carried onto invoices (future partial
    // invoicing uses this; slice 1 converts all-or-nothing).
    invoicedQuantity: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const salesOrderSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    orderNumber: {
      type: String,
      required: [true, "Order number is required"],
      uppercase: true,
      trim: true,
    },

    orderDate: { type: Date, required: true, default: Date.now },
    expectedDeliveryDate: Date,

    // Customer snapshot — same shape as Quote/Invoice (survives renames).
    customer: {
      partyId: { type: Schema.Types.ObjectId, ref: "Party", index: true },
      id: { type: String, index: true },
      name: { type: String, required: true, trim: true },
      email: { type: String, lowercase: true, trim: true },
      phone: { type: String, trim: true },
      address: String,
      taxPin: { type: String, uppercase: true, trim: true },
    },

    // Sales attribution carried from the quote (and onward to the invoice).
    salesPerson: {
      employeeId: { type: Schema.Types.ObjectId, ref: "User" },
      partyId: { type: Schema.Types.ObjectId, ref: "Party" },
      name: String,
      commission: {
        rate: { type: Number, default: 0 },
        amount: { type: Number, default: 0 },
      },
    },

    // Provenance / hand-off references.
    quoteRef: {
      quoteId: { type: Schema.Types.ObjectId, ref: "Quote" },
      quoteNumber: String,
    },
    invoiceRef: {
      invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
      invoiceNumber: String,
      invoicedAt: Date,
    },

    items: {
      type: [salesOrderLineSchema],
      validate: [
        {
          validator: (items) => items && items.length > 0,
          message: "Sales order must have at least one item",
        },
        {
          validator: (items) => items.length <= 50,
          message: "Sales order cannot have more than 50 items",
        },
      ],
    },

    subtotal: { type: Number, required: true, min: 0 },
    totalDiscount: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "KES", uppercase: true },

    status: {
      type: String,
      enum: SALES_ORDER_STATUSES,
      default: "draft",
      index: true,
    },

    notes: String,

    confirmedAt: Date,
    confirmedBy: { name: String, id: String },
    cancelledAt: Date,
    cancelledBy: { name: String, id: String },
    cancellationReason: String,

    createdBy: {
      name: { type: String, required: true },
      id: { type: String, required: true },
    },
    lastModifiedBy: { name: String, id: String },
  },
  { timestamps: true },
);

// List/backlog queries + tenant-unique numbering.
salesOrderSchema.index({ companyId: 1, status: 1, orderDate: -1 });
salesOrderSchema.index({ companyId: 1, "customer.partyId": 1 });
salesOrderSchema.index({ companyId: 1, orderNumber: 1 }, { unique: true });

salesOrderSchema.virtual("isOpen").get(function () {
  return this.status === "draft" || this.status === "confirmed";
});

// SO-{CODE}-{YYYYMM}-{seq} — mirrors Quote.generateQuoteNumber (atomic
// ErpCounter, collision re-check, query fallback, timestamp last resort).
salesOrderSchema.statics.generateOrderNumber = async function (
  companyId = null,
  session = null,
) {
  const ErpCounter = mongoose.model("ErpCounter");
  const Company = mongoose.model("Company");
  const date = new Date();
  const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;

  let companyCode = null;
  if (companyId) {
    let companyQuery = Company.findById(companyId).select("code name").lean();
    if (session) companyQuery = companyQuery.session(session);
    const company = await companyQuery;
    if (company) {
      companyCode =
        company.code ||
        (company.name || "")
          .replace(/[^A-Za-z0-9 ]/g, "")
          .split(/\s+/)
          .map((w) => w[0])
          .join("")
          .toUpperCase()
          .slice(0, 4);
    }
  }

  const prefix = companyCode
    ? `SO-${companyCode}-${yearMonth}`
    : `SO-${yearMonth}`;
  const counterId = companyCode
    ? `salesorder-${companyCode.toLowerCase()}-${yearMonth}`
    : `salesorder-${yearMonth}`;

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const seq = await ErpCounter.getNextSequence(counterId, companyId, session);
      const orderNumber = `${prefix}-${String(seq).padStart(4, "0")}`;

      let existsQuery = this.exists({ companyId, orderNumber });
      if (session) existsQuery = existsQuery.session(session);
      const exists = await existsQuery;
      if (!exists) return orderNumber;

      console.warn(`SO number ${orderNumber} already exists, retrying...`);
    } catch (counterError) {
      // Fallback: last number under this prefix + 1.
      let lastQuery = this.findOne({
        companyId,
        orderNumber: { $regex: `^${prefix}` },
      })
        .sort({ orderNumber: -1 })
        .lean();
      if (session) lastQuery = lastQuery.session(session);
      const last = await lastQuery;
      let nextNum = 1;
      const match = last?.orderNumber?.match(/(\d+)$/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
      const orderNumber = `${prefix}-${String(nextNum).padStart(4, "0")}`;
      let existsQuery = this.exists({ companyId, orderNumber });
      if (session) existsQuery = existsQuery.session(session);
      if (!(await existsQuery)) return orderNumber;
    }
    await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)));
  }

  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 4).toUpperCase();
  return `${prefix}-${timestamp}${random}`;
};

const SalesOrder =
  mongoose.models.SalesOrder || mongoose.model("SalesOrder", salesOrderSchema);

export default SalesOrder;

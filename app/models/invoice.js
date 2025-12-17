import mongoose from "mongoose";

const Schema = mongoose.Schema;

// Line Item Schema (Stock Items and Services)
const lineItemSchema = new Schema({
  type: {
    type: String,
    enum: ["stock", "service"],
    required: true,
  },
  // For stock items
  productId: {
    type: Schema.Types.ObjectId,
    ref: "Product",
  },
  SKU: String,

  // Common fields
  name: {
    type: String,
    required: true,
  },
  description: String,
  unit: {
    type: String,
    default: "pcs",
    required: true, // e.g., "pcs", "hour", "km", "service", "day"
  },
  quantity: {
    type: Number,
    required: true,
    min: 0,
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  total: {
    type: Number,
    required: true,
  },

  // For tracking stock deduction
  stockDeducted: {
    type: Boolean,
    default: false,
  },
});

// Invoice Schema
const invoiceSchema = new Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
    },

    // Customer Information
    customer: {
      id: {
        type: String, // Account ID
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      email: String,
      phone: String,
      address: {
        type: String,
        required: true,
      },
    },

    // Invoice Details
    invoiceDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    dueDate: Date,

    // Line Items
    items: [lineItemSchema],

    // Financial Details
    currency: {
      type: String,
      required: true,
      default: "KES",
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
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
    taxRate: {
      type: Number,
      default: 16, // VAT percentage
      min: 0,
      max: 100,
    },
    taxAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },

    // Payment Information
    paymentStatus: {
      type: String,
      enum: ["paid", "unpaid", "partial", "overdue"],
      default: "unpaid",
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "mpesa", "bank_transfer", "cheque", "credit_card"],
    },
    paymentReference: String,
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Additional Info
    notes: String,
    terms: String,

    // Delivery Note
    dNoteNumber: String,

    // Tracking
    createdBy: {
      name: {
        type: String,
        required: true,
      },
      id: {
        type: String,
        required: true,
      },
      role: String,
    },

    // Related Documents
    relatedDocuments: {
      movementIds: [
        {
          type: Schema.Types.ObjectId,
          ref: "StockMovement",
        },
      ],
    },

    // Status
    status: {
      type: String,
      enum: ["draft", "sent", "paid", "cancelled"],
      default: "draft",
    },
  },
  {
    timestamps: true,
  }
);

// ============================================
// INDEXES
// ============================================
invoiceSchema.index({ invoiceNumber: 1 });
invoiceSchema.index({ "customer.id": 1 });
invoiceSchema.index({ invoiceDate: -1 });
invoiceSchema.index({ paymentStatus: 1 });
invoiceSchema.index({ status: 1 });

// ============================================
// VIRTUALS
// ============================================
invoiceSchema.virtual("balanceDue").get(function () {
  return this.total - this.amountPaid;
});

// ============================================
// METHODS
// ============================================
invoiceSchema.methods.markAsPaid = function (paymentMethod, reference) {
  this.paymentStatus = "paid";
  this.amountPaid = this.total;
  this.paymentMethod = paymentMethod;
  this.paymentReference = reference;
  this.status = "paid";
  return this.save();
};

invoiceSchema.methods.recordPayment = function (
  amount,
  paymentMethod,
  reference
) {
  this.amountPaid += amount;
  this.paymentMethod = paymentMethod;
  this.paymentReference = reference;

  if (this.amountPaid >= this.total) {
    this.paymentStatus = "paid";
    this.status = "paid";
  } else if (this.amountPaid > 0) {
    this.paymentStatus = "partial";
  }

  return this.save();
};

// ============================================
// STATIC METHODS
// ============================================
invoiceSchema.statics.getOverdueInvoices = function () {
  const today = new Date();
  return this.find({
    dueDate: { $lt: today },
    paymentStatus: { $in: ["unpaid", "partial"] },
  });
};

invoiceSchema.statics.getByCustomer = function (customerId) {
  return this.find({ "customer.id": customerId }).sort({ createdAt: -1 });
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

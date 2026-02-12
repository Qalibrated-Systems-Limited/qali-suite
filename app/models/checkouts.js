 import mongoose from "mongoose";

const Schema = mongoose.Schema;

const itemCheckoutSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },
    checkoutNumber: {
      type: String,
      required: true,
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    productSnapshot: {
      name: String,
      SKU: String,
      category: String,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    serialNo: String,
    checkedOutTo: {
      name: { type: String, required: true },
      id: { type: String, required: true },
      department: String,
      email: String,
      phone: String,
    },
    checkedOutBy: {
      name: { type: String, required: true },
      id: { type: String, required: true },
      role: String,
    },
    checkoutDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    purpose: {
      type: String,
      required: true,
    },
    purposeDetails: String,
    expectedReturnDate: {
      type: Date,
      required: true,
    },
    actualReturnDate: Date,
    status: {
      type: String,
      enum: ["checked_out", "returned", "overdue", "lost", "damaged", "converted_to_sale", "expensed"],
      default: "checked_out",
    },
    returnedDate: Date,
    returnedBy: {
      name: String,
      id: String,
    },
    returnCondition: {
      type: String,
      enum: ["excellent", "good", "fair", "poor", "damaged", "lost"],
    },
    returnNotes: String,
    damageDetails: String,
    reminders: [
      {
        sentAt: Date,
        type: {
          type: String,
          enum: ["upcoming", "due_today", "overdue", "final_warning"],
        },
        sentTo: String,
        method: {
          type: String,
          enum: ["email", "sms", "in_app"],
        },
      },
    ],
    relatedDocuments: {
      requestId: {
        type: Schema.Types.ObjectId,
        ref: "StockRequest",
        index: true,
      },
      requestNumber: String,
      movementId: {
        type: Schema.Types.ObjectId,
        ref: "StockMovement",
      },
      returnMovementId: {
        type: Schema.Types.ObjectId,
        ref: "StockMovement",
      },
    },
    // Request type from parent request (for tracking flow)
    requestType: {
      type: String,
      enum: ["demo", "installation", "repair", "internal"],
      index: true,
    },
    // Conversion to sale tracking (customer info fetched from parent request)
    saleConversion: {
      converted: {
        type: Boolean,
        default: false,
      },
      convertedAt: Date,
      convertedBy: {
        name: String,
        id: String,
      },
      invoiceId: {
        type: Schema.Types.ObjectId,
        ref: "Invoice",
      },
      invoiceNumber: String,
      // Partial conversion (some items returned, some sold)
      quantitySold: {
        type: Number,
        default: 0,
      },
      quantityReturned: {
        type: Number,
        default: 0,
      },
    },
    // Expense tracking (for internal use items consumed/used)
    expenseConversion: {
      expensed: {
        type: Boolean,
        default: false,
      },
      expensedAt: Date,
      expensedBy: {
        name: String,
        id: String,
      },
      expenseAccount: {
        id: {
          type: Schema.Types.ObjectId,
          ref: "Account",
        },
        code: String,
        name: String,
      },
      journalEntryId: {
        type: Schema.Types.ObjectId,
        ref: "JournalEntry",
      },
      reason: String,
      quantityExpensed: {
        type: Number,
        default: 0,
      },
      totalCost: {
        type: Number,
        default: 0,
      },
    },
    checkoutNotes: String,
    internalNotes: String,
    isEscalated: {
      type: Boolean,
      default: false,
    },
    escalatedTo: {
      name: String,
      id: String,
      escalatedAt: Date,
      reason: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// INDEXES
// ============================================
// Unique checkout number per company
itemCheckoutSchema.index({ companyId: 1, checkoutNumber: 1 }, { unique: true });
// Query indexes - prefixed with companyId for tenant isolation
itemCheckoutSchema.index({ companyId: 1, status: 1 });
itemCheckoutSchema.index({ companyId: 1, "checkedOutTo.id": 1 });
itemCheckoutSchema.index({ companyId: 1, expectedReturnDate: 1, status: 1 });
itemCheckoutSchema.index({ companyId: 1, productId: 1 });
itemCheckoutSchema.index({ companyId: 1, requestType: 1, status: 1 });
itemCheckoutSchema.index({ companyId: 1, "saleConversion.converted": 1 });

// ============================================
// VIRTUALS
// ============================================
itemCheckoutSchema.virtual("daysOverdue").get(function () {
  if (this.status === "checked_out" && this.expectedReturnDate) {
    const now = new Date();
    const diff = now - this.expectedReturnDate;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
  }
  return 0;
});

itemCheckoutSchema.virtual("daysUntilDue").get(function () {
  if (this.status === "checked_out" && this.expectedReturnDate) {
    const now = new Date();
    const diff = this.expectedReturnDate - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
  }
  return null;
});

itemCheckoutSchema.virtual("isOverdue").get(function () {
  return this.daysOverdue > 0;
});

// ============================================
// NO MIDDLEWARE - TRANSACTION SAFE
// ============================================
// All hooks removed to ensure transaction compatibility

// ============================================
// STATIC METHODS
// ============================================
itemCheckoutSchema.statics.getActiveCheckouts = function () {
  return this.find({
    status: { $in: ["checked_out", "overdue"] },
  }).sort({ expectedReturnDate: 1 });
};

itemCheckoutSchema.statics.getOverdueCheckouts = function () {
  return this.find({
    status: "overdue",
  }).sort({ expectedReturnDate: 1 });
};

itemCheckoutSchema.statics.getUserCheckouts = function (
  userId,
  activeOnly = false
) {
  const query = { "checkedOutTo.id": userId };
  if (activeOnly) {
    query.status = { $in: ["checked_out", "overdue"] };
  }
  return this.find(query).sort({ checkoutDate: -1 });
};

itemCheckoutSchema.statics.getDueSoon = function (days = 3) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  return this.find({
    status: "checked_out",
    expectedReturnDate: { $lte: futureDate, $gte: new Date() },
  }).sort({ expectedReturnDate: 1 });
};

// ============================================
// MODEL EXPORTS
// ============================================
const models = mongoose.models;

let ItemCheckout = models?.ItemCheckout;
if (!ItemCheckout) {
  ItemCheckout = mongoose.model("ItemCheckout", itemCheckoutSchema);
}

export { ItemCheckout };

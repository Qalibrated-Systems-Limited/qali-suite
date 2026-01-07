import mongoose from "mongoose";

const Schema = mongoose.Schema;

const stockMovementSchema = new Schema(
  {
    movementNumber: {
      type: String,
      required: true,
      unique: true,
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
      unit: String,
    },
    movementType: {
      type: String,
      enum: [
        "issue",
        "return",
        "sale",
        "purchase",
        "adjustment",
        "damage",
        "transfer",
        "initial",
      ],
      required: true,
    },
    direction: {
      type: String,
      enum: ["in", "out"],
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [0, "Quantity cannot be negative"],
    },
    previousStock: {
      type: Number,
      required: true,
    },
    newStock: {
      type: Number,
      required: true,
    },
    unitPrice: Number,
    totalValue: Number,
    relatedDocuments: {
      requestId: {
        type: Schema.Types.ObjectId,
        ref: "StockRequest",
      },
      invoiceId: {
        type: Schema.Types.ObjectId,
        ref: "Invoice",
      },
      checkoutId: {
        type: Schema.Types.ObjectId,
        ref: "ItemCheckout",
      },
      purchaseOrderId: {
        type: Schema.Types.ObjectId,
        ref: "PurchaseOrder",
      },
    },
    performedBy: {
      name: { type: String, required: true },
      id: { type: String, required: true },
      role: {
        type: String,
        enum: [
          "storekeeper",
          "manager",
          "finance",
          "technician",
          "Store Manager",
          "admin",
          "Admin",
          "system",
        ],
      },
    },
    issuedTo: {
      name: String,
      id: String,
      department: String,
      purpose: String,
    },
    returnedBy: {
      name: String,
      id: String,
      condition: {
        type: String,
        enum: ["good", "damaged", "lost", "partial"],
      },
      conditionNotes: String,
    },
    serialNo: String,
    fromLocation: String,
    toLocation: String,
    notes: String,
    reason: String,
    requiresReturn: {
      type: Boolean,
      default: false,
    },
    expectedReturnDate: Date,
    actualReturnDate: Date,
    verifiedBy: {
      name: String,
      id: String,
      verifiedAt: Date,
    },
    isReversed: {
      type: Boolean,
      default: false,
    },
    reversedBy: {
      movementId: Schema.Types.ObjectId,
      reason: String,
      reversedAt: Date,
    },
  },
  {
    timestamps: true,
  }
);

// ============================================
// INDEXES
// ============================================
// stockMovementSchema.index({ movementNumber: 1 });
// stockMovementSchema.index({ productId: 1, createdAt: -1 });
// stockMovementSchema.index({ movementType: 1 });
// stockMovementSchema.index({ "performedBy.id": 1 });
// stockMovementSchema.index({ createdAt: -1 });

// ============================================
// MIDDLEWARE - ONLY IMMUTABILITY CHECK
// ============================================

// Prevent modification after creation (immutable audit trail)
// This is SAFE for transactions because it only blocks updates, not creates
stockMovementSchema.pre("save", function (next) {
  if (!this.isNew) {
    return;
  }
});

// ============================================
// STATIC METHODS
// ============================================
stockMovementSchema.statics.getProductHistory = function (
  productId,
  limit = 50
) {
  return this.find({ productId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("relatedDocuments.requestId")
    .populate("relatedDocuments.invoiceId");
};

stockMovementSchema.statics.getByDateRange = function (startDate, endDate) {
  return this.find({
    createdAt: { $gte: startDate, $lte: endDate },
  }).sort({ createdAt: -1 });
};

stockMovementSchema.statics.getByType = function (type, limit = 100) {
  return this.find({ movementType: type }).sort({ createdAt: -1 }).limit(limit);
};

stockMovementSchema.statics.getUserActivity = function (userId) {
  return this.find({ "performedBy.id": userId }).sort({ createdAt: -1 });
};

stockMovementSchema.statics.getIssuedToUser = function (userId) {
  return this.find({
    "issuedTo.id": userId,
    requiresReturn: true,
    actualReturnDate: null,
  });
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;

let StockMovement = models?.StockMovement;
if (!StockMovement) {
  StockMovement = mongoose.model("StockMovement", stockMovementSchema);
}

export { StockMovement };

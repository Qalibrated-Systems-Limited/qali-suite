import { priority, purposeForItemsRemovalFromStock, stockRequestTypes } from "@/lib/utils";
import mongoose from "mongoose";
export const runtime = "nodejs";

const Schema = mongoose.Schema;

const stockRequestSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },
    requestNumber: {
      type: String,
      required: true,
    },
    // Request-level type (industry standard approach)
    requestType: {
      type: String,
      enum: stockRequestTypes,
      required: [true, "Request type is required"],
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

    // Customer/Party snapshot (same pattern as Invoice).
    // Required for customer-facing types only — internal use and employee
    // borrow are intra-company so they have no external customer.
    customer: {
      id: {
        type: String,
        required: function () {
          return !["internal", "employee_borrow"].includes(this.requestType);
        },
        index: true,
      },
      name: {
        type: String,
        required: function () {
          return !["internal", "employee_borrow"].includes(this.requestType);
        },
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
      taxPin: String,
    },
    requester: {
      name: {
        type: String,
        required: true,
      },
      id: {
        type: String,
        required: true,
      },
      department: {
        type: String,
        required: true,
        enum: [
          "Technical",
          "Sales",
          "Service",
          "Installation",
          "Admin",
          "Finance",
          "Other",
        ],
      },
      email: String,
      phone: String,
    },
    items: [
      {
        productId: {
          type: Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        productName: {
          type: String,
          required: true,
        },
        SKU: {
          type: String,
          required: true,
        },
        currentStock: {
          type: Number,
          required: true,
        },
        requestedQuantity: {
          type: Number,
          required: true,
          min: [1, "Quantity must be at least 1"],
        },
        approvedQuantity: {
          type: Number,
          default: 0,
        },
        unitPrice: Number,
        unit: String,
        // Legacy: Item-level purpose (optional, derives from request.requestType)
        purpose: {
          type: String,
          enum: purposeForItemsRemovalFromStock,
        },
        purposeDetails: String,
        requiresReturn: {
          type: Boolean,
          default: false,
        },
        expectedReturnDate: Date,
        notes: String,

        // ============================================
        // FULFILLMENT TRACKING ARRAY
        // ============================================
        fulfillments: [
          {
            quantity: {
              type: Number,
              required: true,
              min: 1,
            },
            serialNumbers: [String],
            fulfilledBy: {
              name: String,
              id: String,
            },
            fulfilledAt: {
              type: Date,
              default: Date.now,
            },
            movementId: {
              type: Schema.Types.ObjectId,
              ref: "StockMovement",
            },
            checkoutId: {
              type: Schema.Types.ObjectId,
              ref: "ItemCheckout",
            },
            deliveryNoteId: {
              type: Schema.Types.ObjectId,
              ref: "DeliveryNote",
            },
            notes: String,
          },
        ],

        // ============================================
        // CALCULATED FIELDS (NO DEFAULTS - calculated on-demand)
        // ============================================
        totalFulfilled: Number,
        remainingToFulfill: Number,
        fulfillmentStatus: {
          type: String,
          enum: ["pending", "partial", "complete"],
        },

        // ============================================
        // INVOICING TRACKING (for sales/installations)
        // ============================================
        invoicedQuantity: {
          type: Number,
          default: 0,
        },
        invoices: [
          {
            invoiceId: {
              type: Schema.Types.ObjectId,
              ref: "Invoice",
            },
            invoiceNumber: String,
            quantity: Number,
            invoicedAt: Date,
          },
        ],
      },
    ],
    status: {
      type: String,
      enum: [
        "pending",
        "approved",
        "partially_fulfilled",
        "fulfilled",
        "invoiced",      // NEW: Items have been invoiced (for sales)
        "rejected",
        "cancelled",
      ],
      default: "pending",
      required: true,
    },
    priority: {
      type: String,
      enum: priority,
      default: "normal",
    },
    approver: {
      name: String,
      id: String,
      approvedAt: Date,
      comments: String,
      conditions: String,
    },
    rejectionReason: String,
    rejectedAt: Date,
    rejectedBy: {
      name: String,
      id: String,
    },
    cancellationReason: String,
    cancelledAt: Date,
    notes: String,
    requiredByDate: Date,
    totalValue: {
      type: Number,
      default: 0,
    },
    // Draft invoice (created at fulfillment for "sale" type requests)
    draftInvoice: {
      invoiceId: {
        type: Schema.Types.ObjectId,
        ref: "Invoice",
      },
      invoiceNumber: String,
      createdAt: Date,
    },
    approvalHistory: [
      {
        approverName: String,
        approverId: String,
        action: {
          type: String,
          enum: ["approved", "rejected", "requested_changes"],
        },
        comments: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    attachments: [
      {
        filename: String,
        url: String,
        uploadedAt: Date,
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// VIRTUALS (Read-only computed properties - SAFE)
// ============================================
stockRequestSchema.virtual("isOverdue").get(function () {
  if (this.requiredByDate && this.status === "pending") {
    return new Date() > this.requiredByDate;
  }
  return false;
});

stockRequestSchema.virtual("totalItemsRequested").get(function () {
  return this.items.reduce((sum, item) => sum + item.requestedQuantity, 0);
});

stockRequestSchema.virtual("totalItemsApproved").get(function () {
  return this.items.reduce(
    (sum, item) => sum + (item.approvedQuantity || 0),
    0
  );
});

stockRequestSchema.virtual("totalItemsFulfilled").get(function () {
  return this.items.reduce((sum, item) => sum + (item.totalFulfilled || 0), 0);
});

stockRequestSchema.virtual("fulfillmentProgress").get(function () {
  const approved = this.totalItemsApproved;
  const fulfilled = this.totalItemsFulfilled;
  if (approved === 0) return 0;
  return Math.round((fulfilled / approved) * 100);
});

// ============================================
// NO PRE-SAVE MIDDLEWARE! (Transaction-safe)
// ============================================
// We calculate manually in actions using helper methods

// ============================================
// HELPER METHOD: Recalculate Fulfillment (Instance)
// ============================================
stockRequestSchema.methods.recalculateFulfillment = function () {
  // Calculate for each item
  this.items.forEach((item) => {
    // Calculate total fulfilled from fulfillments array
    item.totalFulfilled = item.fulfillments.reduce(
      (sum, f) => sum + (f.quantity || 0),
      0
    );

    // Calculate remaining
    const target = item.approvedQuantity || item.requestedQuantity || 0;
    item.remainingToFulfill = Math.max(0, target - item.totalFulfilled);

    // Set item status
    if (item.totalFulfilled === 0) {
      item.fulfillmentStatus = "pending";
    } else if (item.totalFulfilled >= target) {
      item.fulfillmentStatus = "complete";
    } else {
      item.fulfillmentStatus = "partial";
    }
  });

  // Calculate request status
  const allComplete = this.items.every(
    (item) => item.fulfillmentStatus === "complete"
  );
  const someComplete = this.items.some((item) => item.totalFulfilled > 0);

  const validStatuses = ["approved", "partially_fulfilled"];
  if (validStatuses.includes(this.status)) {
    if (allComplete) {
      this.status = "fulfilled";
    } else if (someComplete) {
      this.status = "partially_fulfilled";
    }
  }

  // Calculate total value
  this.totalValue = this.items.reduce((sum, item) => {
    const qty = item.approvedQuantity || item.requestedQuantity;
    return sum + qty * (item.unitPrice || 0);
  }, 0);

  return this;
};

// ============================================
// HELPER METHOD: Add Fulfillment (Instance)
// ============================================
stockRequestSchema.methods.addFulfillment = function (itemId, fulfillmentData) {
  const item = this.items.id(itemId);

  if (!item) {
    throw new Error("Item not found in request");
  }

  // Validate quantity
  const currentTotal = item.fulfillments.reduce(
    (sum, f) => sum + (f.quantity || 0),
    0
  );
  const target = item.approvedQuantity || item.requestedQuantity || 0;
  const newTotal = currentTotal + fulfillmentData.quantity;

  if (newTotal > target) {
    throw new Error(
      `Cannot fulfill ${fulfillmentData.quantity}. ` +
        `Only ${target - currentTotal} remaining.`
    );
  }

  // Add fulfillment to array
  item.fulfillments.push({
    quantity: fulfillmentData.quantity,
    serialNumbers: fulfillmentData.serialNumbers || [],
    fulfilledBy: fulfillmentData.fulfilledBy,
    fulfilledAt: fulfillmentData.fulfilledAt || new Date(),
    movementId: fulfillmentData.movementId,
    checkoutId: fulfillmentData.checkoutId,
    deliveryNoteId: fulfillmentData.deliveryNoteId,
    notes: fulfillmentData.notes || "",
  });

  // Recalculate totals
  this.recalculateFulfillment();

  return this;
};

// ============================================
// STATIC METHODS
// ============================================
stockRequestSchema.statics.getPendingCount = function () {
  return this.countDocuments({ status: "pending" });
};

stockRequestSchema.statics.getByDepartment = function (
  department,
  status = null
) {
  const query = { "requester.department": department };
  if (status) query.status = status;
  return this.find(query).sort({ createdAt: -1 });
};

stockRequestSchema.statics.getUrgentRequests = function () {
  return this.find({
    priority: { $in: ["high", "urgent"] },
    status: { $in: ["pending", "approved", "partially_fulfilled"] },
  }).sort({ priority: -1, createdAt: 1 });
};

stockRequestSchema.statics.getOverdueRequests = function () {
  return this.find({
    requiredByDate: { $lt: new Date() },
    status: { $in: ["pending", "approved", "partially_fulfilled"] },
  }).sort({ requiredByDate: 1 });
};

stockRequestSchema.statics.getNeedsApproval = function () {
  return this.find({ status: "pending" }).sort({ priority: -1, createdAt: 1 });
};

stockRequestSchema.statics.getNeedsFulfillment = function () {
  return this.find({
    status: { $in: ["approved", "partially_fulfilled"] },
  }).sort({ priority: -1, createdAt: 1 });
};

// ============================================
// INSTANCE METHODS
// ============================================
stockRequestSchema.methods.approve = function (
  approverData,
  itemApprovals = null
) {
  this.status = "approved";
  this.approver = {
    name: approverData.name,
    id: approverData.id,
    approvedAt: new Date(),
    comments: approverData.comments,
    conditions: approverData.conditions,
  };

  // Set approved quantities for each item
  if (itemApprovals) {
    this.items.forEach((item) => {
      const approval = itemApprovals[item._id.toString()];
      if (approval) {
        item.approvedQuantity = approval.quantity;
        item.notes = approval.notes || item.notes;
      } else {
        item.approvedQuantity = item.requestedQuantity;
      }
    });
  } else {
    this.items.forEach((item) => {
      item.approvedQuantity = item.requestedQuantity;
    });
  }

  this.approvalHistory.push({
    approverName: approverData.name,
    approverId: approverData.id,
    action: "approved",
    comments: approverData.comments,
    timestamp: new Date(),
  });

  // Recalculate after approval
  this.recalculateFulfillment();

  return this.save();
};

stockRequestSchema.methods.reject = function (rejectorData) {
  this.status = "rejected";
  this.rejectionReason = rejectorData.reason;
  this.rejectedAt = new Date();
  this.rejectedBy = {
    name: rejectorData.name,
    id: rejectorData.id,
  };

  this.approvalHistory.push({
    approverName: rejectorData.name,
    approverId: rejectorData.id,
    action: "rejected",
    comments: rejectorData.reason,
    timestamp: new Date(),
  });

  return this.save();
};

stockRequestSchema.methods.cancel = function (reason) {
  this.status = "cancelled";
  this.cancellationReason = reason;
  this.cancelledAt = new Date();
  return this.save();
};

stockRequestSchema.methods.canApprove = function (userId) {
  if (this.requester.id === userId) return false;
  if (this.status !== "pending") return false;
  return true;
};

stockRequestSchema.methods.canFulfill = function () {
  return this.status === "approved" || this.status === "partially_fulfilled";
};

stockRequestSchema.methods.hasUnfulfilledItems = function () {
  return this.items.some((item) => (item.remainingToFulfill || 0) > 0);
};

// ============================================
// INDEXES
// ============================================
// Unique request number per company
stockRequestSchema.index({ companyId: 1, requestNumber: 1 }, { unique: true });
// Query indexes - prefixed with companyId for tenant isolation
stockRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });
stockRequestSchema.index({ companyId: 1, "requester.department": 1, status: 1 });
stockRequestSchema.index({ companyId: 1, priority: 1, status: 1 });
stockRequestSchema.index({ companyId: 1, requiredByDate: 1, status: 1 });
stockRequestSchema.index({ companyId: 1, requestType: 1, status: 1 });
stockRequestSchema.index({ companyId: 1, "customer.id": 1, status: 1 });

const models = mongoose.models;
let StockRequest = models ? models.StockRequest : null;

if (StockRequest) {
  StockRequest = StockRequest;
} else {
  StockRequest = mongoose.model("StockRequest", stockRequestSchema);
}

export { StockRequest };

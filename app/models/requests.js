import { priority, purposeForItemsRemovalFromStock } from "@/lib/utils";
import mongoose from "mongoose";
export const runtime = "nodejs";

const Schema = mongoose.Schema;

const stockRequestSchema = new Schema(
  {
    requestNumber: {
      type: String,
      required: true,
      unique: true,
    },
    customer: {
      type: String,
      required: true,
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
        },
        fulfilledQuantity: {
          type: Number,
        },
        unitPrice: Number,
        unit: String,
        purpose: {
          type: String,
          enum: purposeForItemsRemovalFromStock,
          required: true,
        },
        purposeDetails: {
          type: String,
        },
        requiresReturn: {
          type: Boolean,
          default: false,
        },
        expectedReturnDate: Date,
        serialNo: String,
        notes: String,
      },
    ],
    status: {
      type: String,
      enum: [
        "pending",
        "approved",
        "partially_fulfilled",
        "fulfilled",
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
    storekeeper: {
      name: String,
      id: String,
      fulfilledAt: Date,
      comments: String,
      issues: String,
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
    notifications: {
      requesterNotified: { type: Boolean, default: false },
      approverNotified: { type: Boolean, default: false },
      storekeeperNotified: { type: Boolean, default: false },
    },
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
// INDEXES
// ============================================
// stockRequestSchema.index({ requestNumber: 1 });
// stockRequestSchema.index({ status: 1 });
// stockRequestSchema.index({ "requester.id": 1 });
// stockRequestSchema.index({ "requester.department": 1 });
// stockRequestSchema.index({ createdAt: -1 });
// stockRequestSchema.index({ priority: 1, status: 1 });
// stockRequestSchema.index({ "approver.id": 1 });

// ============================================
// VIRTUALS (These are OK - they don't affect DB)
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

stockRequestSchema.virtual("processingTime").get(function () {
  if (this.status === "fulfilled" && this.storekeeper.fulfilledAt) {
    const diff = this.storekeeper.fulfilledAt - this.createdAt;
    return Math.floor(diff / (1000 * 60 * 60));
  }
  return null;
});

// ============================================
// MIDDLEWARE - KEEP ONLY NON-CONFLICTING ONES
// ============================================

// Calculate total value before saving (THIS IS OK)
stockRequestSchema.pre("save", function (next) {
  this.totalValue = this.items.reduce((sum, item) => {
    const qty = item.approvedQuantity || item.requestedQuantity;
    return sum + qty * (item.unitPrice || 0);
  }, 0);
  next();
});

// ❌ REMOVED: Auto-generate request number
// ❌ REMOVED: Post-save hook that updates Product stock
// These conflict with transactions - handle manually instead!

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
    status: { $in: ["pending", "approved"] },
  }).sort({ priority: -1, createdAt: 1 });
};

stockRequestSchema.statics.getOverdueRequests = function () {
  return this.find({
    requiredByDate: { $lt: new Date() },
    status: { $in: ["pending", "approved"] },
  }).sort({ requiredByDate: 1 });
};

stockRequestSchema.statics.getNeedsApproval = function () {
  return this.find({ status: "pending" }).sort({ priority: -1, createdAt: 1 });
};

stockRequestSchema.statics.getNeedsFulfillment = function () {
  return this.find({ status: "approved" }).sort({ priority: -1, createdAt: 1 });
};

// ============================================
// INSTANCE METHODS
// ============================================
stockRequestSchema.methods.approve = function (approverData) {
  this.status = "approved";
  this.approver = {
    name: approverData.name,
    id: approverData.id,
    approvedAt: new Date(),
    comments: approverData.comments,
    conditions: approverData.conditions,
  };

  this.approvalHistory.push({
    approverName: approverData.name,
    approverId: approverData.id,
    action: "approved",
    comments: approverData.comments,
    timestamp: new Date(),
  });

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
  return this.status === "approved";
};

const models = mongoose.models;
let StockRequest = models ? models.StockRequest : null;

if (StockRequest) {
  StockRequest = StockRequest;
} else {
  StockRequest = mongoose.model("StockRequest", stockRequestSchema);
}

export { StockRequest };

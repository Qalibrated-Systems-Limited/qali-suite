import { advanceTypesList } from "@/lib/utils";
import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// EMPLOYEE CLAIM SCHEMA - ADVANCES & REIMBURSEMENTS
// ============================================
const employeeClaimSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Claim Identification
    claimNumber: {
      type: String,
      required: [true, "Claim number is required"],
    },

    claimDate: {
      type: Date,
      required: [true, "Claim date is required"],
      index: true,
    },

    // In EmployeeClaim schema, add:
    settlementClaimId: {
      type: Schema.Types.ObjectId,
      ref: "EmployeeClaim",
      // Links advance_request to its advance_return settlement
      // Prevents double settlement
    },

    // Project (optional — any claim can be linked to a project)
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

    // Employee (links to User AND Party)
    employee: {
      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: [true, "User ID is required"],
        index: true,
      },
      partyId: {
        type: Schema.Types.ObjectId,
        ref: "Party",
        required: [true, "Party ID is required"],
        index: true,
      },
      name: {
        type: String,
        required: [true, "Employee name is required"],
      },
      employeeNumber: String,
      department: String,
      email: String,
    },

    // Claim Type
    claimType: {
      type: String,
      enum: {
        values: ["advance_request", "advance_return", "reimbursement"],
        message: "{VALUE} is not a valid claim type",
      },
      required: [true, "Claim type is required"],
      index: true,
    },

    // For Advance Request (travel, petty_cash, operational)
    // "project" kept in enum for backward compatibility with existing data
    advanceDetails: {
      advanceType: {
        type: String,
        enum: {
          values: [...advanceTypesList, "project"],
          message: "{VALUE} is not a valid advance type",
        },
        default: "travel",
      },
      requestedAmount: {
        type: Number,
        min: 0,
      },
      purpose: String,
      // Travel-specific (optional - required only for travel type)
      travelDates: {
        from: Date,
        to: Date,
      },
      destination: String,
      // Legacy field — kept for existing data, no longer set on new claims
      projectCode: String,
      // Common optional
      estimatedExpenses: String,
      approvedAmount: Number,
      disbursedAmount: Number,
      disbursementDate: Date,
    },

    // For Advance Return (after trip/activity)
    // REPLACE WITH:
    returnDetails: {
      // Link to original advance claim
      advanceClaimId: {
        type: Schema.Types.ObjectId,
        ref: "EmployeeClaim",
        // The advance_request claim this settlement is for
      },

      advancePaymentId: {
        type: Schema.Types.ObjectId,
        ref: "Payment",
        // The payment that funded the advance
      },

      advanceAmount: {
        type: Number,
        min: 0,
        // Original advance amount received
      },

      totalSpent: {
        type: Number,
        min: 0,
        // Actual amount spent (sum of items)
      },

      balance: {
        type: Number,
        // Calculated: advanceAmount - totalSpent
        // Positive = employee owes company
        // Negative = company owes employee
      },

      // Track cash return from employee (when balance > 0)
      amountReturned: {
        type: Number,
        default: 0,
        min: 0,
      },

      returnRecordedAt: Date,

      returnRecordedBy: {
        name: String,
        id: String,
      },

      // Track payment to employee (when balance < 0)
      amountPaidToEmployee: {
        type: Number,
        default: 0,
        min: 0,
      },

      extraPaidAt: Date,

      extraPaidBy: {
        name: String,
        id: String,
      },
    },

    // Expense Items (receipts)
    items: [
      {
        date: {
          type: Date,
          required: true,
        },
        category: {
          type: String,
          required: true,
        },
        expenseAccountId: {
          type: Schema.Types.ObjectId,
          ref: "Account",
        },
        description: {
          type: String,
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        receipt: {
          filename: String,
          url: String,
          uploadedAt: {
            type: Date,
            default: Date.now,
          },
        },
        notes: String,
      },
    ],

    // Totals
    totalAmount: {
      type: Number,
      required: [true, "Total amount is required"],
      min: 0,
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
    },

    // Description
    description: {
      type: String,
      required: [true, "Description is required"],
    },

    notes: String,

    // Receipts & Attachments
    receipts: [
      {
        filename: String,
        url: String,
        publicId: String,
        resourceType: String,
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

    // Approval Workflow
    status: {
      type: String,
      enum: {
        values: [
          "draft",
          "submitted",
          "approved",
          "rejected",
          "paid",
          "pending_return", // After closeSettlement when employee owes company
          "pending_payment", // After closeSettlement when company owes employee
          "closed",
        ],
        message: "{VALUE} is not a valid status",
      },
      default: "draft",
      index: true,
    },

    submittedAt: Date,

    submittedBy: {
      name: String,
      id: String,
    },

    approvedAt: Date,

    approvedBy: {
      name: String,
      id: String,
    },

    rejectedAt: Date,

    rejectedBy: {
      name: String,
      id: String,
    },

    rejectionReason: String,

    // Payment References
    advancePaymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      // Payment for advance request
    },

    settlementPaymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      // Payment for reimbursement or return
    },

    paidAt: Date,

    // Accounting References
    journalEntryIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "JournalEntry",
      },
    ],

    // Audit Trail
    createdBy: {
      name: {
        type: String,
        required: true,
      },
      id: {
        type: String,
        required: true,
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
  }
);

// ============================================
// COMPOUND INDEXES FOR QUERY EFFICIENCY
// ============================================
// Unique claim number per company
employeeClaimSchema.index({ companyId: 1, claimNumber: 1 }, { unique: true });
// Query indexes - prefixed with companyId for tenant isolation
employeeClaimSchema.index({ companyId: 1, claimDate: -1, status: 1 });
employeeClaimSchema.index({ companyId: 1, "employee.userId": 1, status: 1 });
employeeClaimSchema.index({ companyId: 1, "employee.partyId": 1, status: 1 });
employeeClaimSchema.index({ companyId: 1, claimType: 1, status: 1 });

// ============================================
// VIRTUALS
// ============================================
employeeClaimSchema.virtual("isPaid").get(function () {
  return this.status === "paid" || this.status === "closed";
});

employeeClaimSchema.virtual("needsApproval").get(function () {
  return this.status === "submitted";
});

employeeClaimSchema.virtual("hasItems").get(function () {
  return this.items && this.items.length > 0;
});

employeeClaimSchema.virtual("isAdvanceRequest").get(function () {
  return this.claimType === "advance_request";
});

employeeClaimSchema.virtual("isAdvanceReturn").get(function () {
  return this.claimType === "advance_return";
});

employeeClaimSchema.virtual("isReimbursement").get(function () {
  return this.claimType === "reimbursement";
});

// ============================================
// VALIDATION METHODS
// ============================================

// Validate advance request
employeeClaimSchema.methods.validateAdvanceRequest = function () {
  if (this.claimType !== "advance_request") return true;

  if (!this.advanceDetails || !this.advanceDetails.requestedAmount) {
    throw new Error("Requested amount is required for advance request");
  }

  if (!this.advanceDetails.purpose) {
    throw new Error("Purpose is required for advance request");
  }

  this.totalAmount = this.advanceDetails.requestedAmount;

  return true;
};

// Validate advance return
employeeClaimSchema.methods.validateAdvanceReturn = function () {
  if (this.claimType !== "advance_return") return true;

  if (!this.returnDetails || !this.returnDetails.advancePaymentId) {
    throw new Error("Advance payment reference is required for return");
  }

  if (!this.returnDetails.advanceAmount) {
    throw new Error("Advance amount is required");
  }

  // Calculate total spent
  const totalSpent = this.items.reduce(
    (sum, item) => sum + (item.amount || 0),
    0
  );

  this.returnDetails.totalSpent = totalSpent;
  this.returnDetails.balance = this.returnDetails.advanceAmount - totalSpent;
  this.totalAmount = totalSpent;

  return true;
};

// Validate reimbursement
employeeClaimSchema.methods.validateReimbursement = function () {
  if (this.claimType !== "reimbursement") return true;

  if (!this.items || this.items.length === 0) {
    throw new Error("At least one expense item is required");
  }

  // Calculate total
  const total = this.items.reduce((sum, item) => sum + (item.amount || 0), 0);
  this.totalAmount = total;

  return true;
};

// Complete validation
employeeClaimSchema.methods.validateBeforeSubmit = function () {
  this.validateAdvanceRequest();
  this.validateAdvanceReturn();
  this.validateReimbursement();
  return true;
};

// ============================================
// SUBMIT CLAIM
// ============================================
employeeClaimSchema.methods.submit = async function (submittedBy) {
  if (this.status !== "draft") {
    throw new Error("Can only submit draft claims");
  }

  this.validateBeforeSubmit();

  this.status = "submitted";
  this.submittedAt = new Date();
  this.submittedBy = submittedBy;
  await this.save();

  return this;
};

// ============================================
// APPROVE CLAIM
// ============================================
employeeClaimSchema.methods.approve = async function (approvedBy) {
  if (this.status !== "submitted") {
    throw new Error("Can only approve submitted claims");
  }

  this.validateBeforeSubmit();

  this.status = "approved";
  this.approvedAt = new Date();
  this.approvedBy = approvedBy;
  await this.save();

  return this;
};

// ============================================
// REJECT CLAIM
// ============================================
employeeClaimSchema.methods.reject = async function (rejectedBy, reason) {
  if (this.status !== "submitted") {
    throw new Error("Can only reject submitted claims");
  }

  if (!reason || reason.trim().length === 0) {
    throw new Error("Rejection reason is required");
  }

  this.status = "rejected";
  this.rejectedAt = new Date();
  this.rejectedBy = rejectedBy;
  this.rejectionReason = reason;
  await this.save();

  return this;
};

// ============================================
// RECALL CLAIM (submitted → draft)
// ============================================
employeeClaimSchema.methods.recall = async function (recalledBy) {
  if (this.status !== "submitted") {
    throw new Error("Can only recall submitted claims");
  }

  this.status = "draft";
  this.submittedAt = null;
  this.submittedBy = null;
  await this.save();

  return this;
};

// ============================================
// RESUBMIT CLAIM (rejected → submitted)
// ============================================
employeeClaimSchema.methods.resubmit = async function (resubmittedBy) {
  if (this.status !== "rejected") {
    throw new Error("Can only resubmit rejected claims");
  }

  this.validateBeforeSubmit();

  this.status = "submitted";
  this.submittedAt = new Date();
  this.submittedBy = resubmittedBy;
  this.rejectedAt = null;
  this.rejectedBy = null;
  this.rejectionReason = null;
  await this.save();

  return this;
};

// ============================================
// MARK AS PAID
// ============================================
employeeClaimSchema.methods.markAsPaid = async function (paymentId) {
  if (this.status !== "approved") {
    throw new Error("Claim must be approved before marking as paid");
  }

  if (this.claimType === "advance_request") {
    this.advancePaymentId = paymentId;
  } else {
    this.settlementPaymentId = paymentId;
  }

  this.paidAt = new Date();
  this.status = "paid";
  await this.save();

  return this;
};

// ============================================
// STATIC METHODS
// ============================================

employeeClaimSchema.statics.getPendingApproval = function () {
  return this.find({
    status: "submitted",
  })
    .sort({ submittedAt: -1 })
    .lean();
};

employeeClaimSchema.statics.getEmployeeClaims = function (
  userId,
  status = null
) {
  const query = {
    "employee.userId": userId,
  };

  if (status) {
    query.status = status;
  }

  return this.find(query).sort({ claimDate: -1 }).lean();
};

employeeClaimSchema.statics.getApprovedPendingPayment = function () {
  return this.find({
    status: "approved",
    paidAt: null,
  })
    .sort({ approvedAt: -1 })
    .lean();
};



// ============================================
// 4. ADD NEW VIRTUALS
// ============================================
// Add after existing virtuals:

employeeClaimSchema.virtual("isPendingReturn").get(function () {
  return this.status === "pending_return";
});

employeeClaimSchema.virtual("isPendingPayment").get(function () {
  return this.status === "pending_payment";
});

employeeClaimSchema.virtual("isSettled").get(function () {
  return (
    this.claimType === "advance_request" && 
    this.settlementClaimId != null
  );
});

employeeClaimSchema.virtual("settlementBalance").get(function () {
  if (this.claimType !== "advance_return") return null;
  return this.returnDetails?.balance || 0;
});

employeeClaimSchema.virtual("remainingToReturn").get(function () {
  if (this.claimType !== "advance_return") return null;
  const balance = this.returnDetails?.balance || 0;
  const returned = this.returnDetails?.amountReturned || 0;
  return balance > 0 ? Math.max(0, balance - returned) : 0;
});

employeeClaimSchema.virtual("remainingToPayEmployee").get(function () {
  if (this.claimType !== "advance_return") return null;
  const balance = this.returnDetails?.balance || 0;
  const paid = this.returnDetails?.amountPaidToEmployee || 0;
  return balance < 0 ? Math.max(0, Math.abs(balance) - paid) : 0;
});

employeeClaimSchema.virtual("isFullySettled").get(function () {
  if (this.claimType !== "advance_return") return false;
  
  const balance = this.returnDetails?.balance || 0;
  
  if (balance === 0) return this.status === "closed";
  
  if (balance > 0) {
    const returned = this.returnDetails?.amountReturned || 0;
    return returned >= balance;
  }
  
  if (balance < 0) {
    const paid = this.returnDetails?.amountPaidToEmployee || 0;
    return paid >= Math.abs(balance);
  }
  
  return false;
});


// ============================================
// 5. ADD NEW STATIC METHODS
// ============================================

/**
 * Get settlements pending return (employee owes company)
 */
employeeClaimSchema.statics.getPendingReturns = function () {
  return this.find({
    claimType: "advance_return",
    status: "pending_return",
  })
    .sort({ updatedAt: -1 })
    .lean();
};

/**
 * Get settlements pending payment (company owes employee)
 */
employeeClaimSchema.statics.getPendingPayments = function () {
  return this.find({
    claimType: "advance_return",
    status: "pending_payment",
  })
    .sort({ updatedAt: -1 })
    .lean();
};

/**
 * Get settlement for an advance
 */
employeeClaimSchema.statics.getSettlementForAdvance = function (advanceClaimId) {
  return this.findOne({
    claimType: "advance_return",
    "returnDetails.advanceClaimId": advanceClaimId,
    status: { $nin: ["rejected"] },
  });
};

/**
 * Check if advance can be settled
 */
employeeClaimSchema.statics.canSettle = async function (advanceClaimId) {
  const advance = await this.findById(advanceClaimId);
  
  if (!advance) {
    return { canSettle: false, reason: "Advance not found" };
  }
  
  if (advance.claimType !== "advance_request") {
    return { canSettle: false, reason: "Not an advance request" };
  }
  
  if (advance.status !== "paid") {
    return { canSettle: false, reason: `Advance status is ${advance.status}, must be paid` };
  }
  
  if (advance.settlementClaimId) {
    return { 
      canSettle: false, 
      reason: "Already settled",
      existingSettlementId: advance.settlementClaimId,
    };
  }
  
  // Check for existing settlement
  const existingSettlement = await this.findOne({
    claimType: "advance_return",
    "returnDetails.advanceClaimId": advanceClaimId,
    status: { $nin: ["rejected"] },
  });
  
  if (existingSettlement) {
    return {
      canSettle: false,
      reason: `Settlement ${existingSettlement.claimNumber} already exists`,
      existingSettlementId: existingSettlement._id,
    };
  }
  
  return { canSettle: true };
};


// ============================================
// 6. ADD INDEX FOR SETTLEMENT LOOKUP
// ============================================
// Add to compound indexes:

employeeClaimSchema.index({ "returnDetails.advanceClaimId": 1 }, { sparse: true });
employeeClaimSchema.index({ settlementClaimId: 1 }, { sparse: true });


// ============================================
// 7. ADD PRE-SAVE VALIDATION
// ============================================
// Add this pre-save hook:

employeeClaimSchema.pre("save", async function (next) {
  // Recalculate balance for advance_return
  if (this.claimType === "advance_return" && this.isModified("items")) {
    const totalSpent = this.items.reduce(
      (sum, item) => sum + (item.amount || 0),
      0
    );
    
    this.returnDetails.totalSpent = totalSpent;
    this.totalAmount = totalSpent;
    
    if (this.returnDetails.advanceAmount) {
      this.returnDetails.balance = 
        this.returnDetails.advanceAmount - totalSpent;
    }
  }
  
  
});

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let EmployeeClaim = models?.EmployeeClaim;

if (!EmployeeClaim) {
  EmployeeClaim = mongoose.model("EmployeeClaim", employeeClaimSchema);
}

export default EmployeeClaim;

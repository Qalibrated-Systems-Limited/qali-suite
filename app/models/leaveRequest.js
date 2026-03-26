import mongoose from "mongoose";
import { ErpCounter } from "./erp-counter";

const Schema = mongoose.Schema;

// ============================================
// LEAVE REQUEST SCHEMA
// ============================================
// Design:
// - SEPARATE collection (not embedded in EmployeeProfile)
//   Reason: unbounded — an employee can have hundreds of leave records over time.
//   Embedding would bloat the profile document with no upper bound.
//
// - Parent reference: employee.partyId links back to Party
//   Same pattern as EmployeeClaim (employee.userId, employee.partyId)
//
// - Embedded employee snapshot (name, number, department):
//   Avoids $lookup on every list query. Snapshot is taken at request creation.
//
// - Status flow (mirrors EmployeeClaim pattern):
//   draft → submitted → approved → completed
//                    → rejected
//   submitted → recalled → draft
//
// - Leave balance interaction:
//   submitted  → EmployeeProfile.markLeavePending(+days)
//   approved   → EmployeeProfile.debitLeave(+days), pendingDays(-days)
//   rejected   → EmployeeProfile.releasePendingLeave(-days)
//   recalled   → EmployeeProfile.releasePendingLeave(-days)
//   cancelled (approved) → restore usedDays, balanceDays (rare, admin only)
// ============================================

const leaveRequestSchema = new Schema(
  {
    // Tenant isolation
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Auto-generated: "LV-2026-0001"
    leaveNumber: {
      type: String,
      required: [true, "Leave number is required"],
    },

    // ============================================
    // EMPLOYEE SNAPSHOT (avoids $lookup on list view)
    // ============================================
    employee: {
      partyId: {
        type: Schema.Types.ObjectId,
        ref: "Party",
        required: [true, "Employee Party ID is required"],
        index: true,
      },
      profileId: {
        type: Schema.Types.ObjectId,
        ref: "EmployeeProfile",
        required: [true, "Employee Profile ID is required"],
      },
      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
      name: {
        type: String,
        required: [true, "Employee name is required"],
      },
      employeeNumber: String,
      department: String,
      designation: String,
    },

    // ============================================
    // LEAVE DETAILS
    // ============================================
    leaveType: {
      type: String,
      required: [true, "Leave type is required"],
      index: true,
    },

    dates: {
      
      from: {
        type: Date,
        required: [true, "Start date is required"],
      },
      to: {
        type: Date,
        required: [true, "End date is required"],
      },
      // Calculated at creation (excludes weekends and public holidays)
      totalDays: {
        type: Number,
        required: [true, "Total days is required"],
        min: [0.5, "Minimum leave is half a day"],
      },
      halfDay: {
        type: Boolean,
        default: false,
      },
      halfDayPeriod: {
        type: String,
        enum: ["morning", "afternoon"],
      },
    },

    reason: {
      type: String,
      trim: true,
      maxlength: [500, "Reason cannot exceed 500 characters"],
    },

    // Supporting documents (sick notes, etc.)
    attachments: [
      {
        name: String,
        url: String,
        publicId: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    // Handover notes (who covers during absence)
    handover: {
      coveringPartyId: { type: Schema.Types.ObjectId, ref: "Party" },
      coveringName: String,
      notes: String,
    },

    // ============================================
    // STATUS & WORKFLOW
    // ============================================
    status: {
      type: String,
      enum: {
        values: ["draft", "submitted", "approved", "rejected", "recalled", "completed", "cancelled"],
        message: "{VALUE} is not a valid status",
      },
      default: "draft",
      index: true,
    },

    submittedAt: Date,
    submittedBy: { name: String, id: String },

    approvedAt: Date,
    approvedBy: { name: String, id: String },

    rejectedAt: Date,
    rejectedBy: { name: String, id: String },
    rejectionReason: String,

    recalledAt: Date,

    completedAt: Date,    // When the leave period ends (auto or manual)

    cancelledAt: Date,
    cancelledBy: { name: String, id: String },
    cancellationReason: String,

    // Snapshot of balance at time of request (for audit trail)
    balanceSnapshot: {
      entitledDays: Number,
      usedDaysBefore: Number,
      balanceBefore: Number,
    },

    notes: {
      type: String,
      maxlength: [500, "Notes cannot exceed 500 characters"],
    },

    // Audit trail
    createdBy: { name: String, id: String },
    lastModifiedBy: { name: String, id: String },
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
// Unique leave number per company
leaveRequestSchema.index({ companyId: 1, leaveNumber: 1 }, { unique: true });
// Hot query paths
leaveRequestSchema.index({ companyId: 1, "employee.partyId": 1, status: 1 });
leaveRequestSchema.index({ companyId: 1, status: 1, "dates.from": -1 });
leaveRequestSchema.index({ companyId: 1, leaveType: 1, status: 1 });
// Date range queries (for leave calendar, conflict detection)
leaveRequestSchema.index({ companyId: 1, "dates.from": 1, "dates.to": 1 });

// ============================================
// VIRTUALS
// ============================================
leaveRequestSchema.virtual("isPending").get(function () {
  return this.status === "submitted";
});

leaveRequestSchema.virtual("isApproved").get(function () {
  return this.status === "approved" || this.status === "completed";
});

leaveRequestSchema.virtual("isActive").get(function () {
  if (this.status !== "approved") return false;
  const now = new Date();
  return this.dates.from <= now && this.dates.to >= now;
});

// ============================================
// VALIDATION
// ============================================
leaveRequestSchema.pre("validate", function () {
  if (this.dates?.from && this.dates?.to) {
    if (this.dates.to < this.dates.from) {
      this.invalidate("dates.to", "End date cannot be before start date");
    }
  }
});

// ============================================
// INSTANCE METHODS (mirror EmployeeClaim pattern)
// ============================================

leaveRequestSchema.methods.submit = async function (submittedBy, options = {}) {
  if (this.status !== "draft") throw new Error("Only draft requests can be submitted");
  this.status = "submitted";
  this.submittedAt = new Date();
  this.submittedBy = submittedBy;
  await this.save(options);
  return this;
};

leaveRequestSchema.methods.approve = async function (approvedBy, options = {}) {
  if (this.status !== "submitted") throw new Error("Only submitted requests can be approved");
  this.status = "approved";
  this.approvedAt = new Date();
  this.approvedBy = approvedBy;
  await this.save(options);
  return this;
};

leaveRequestSchema.methods.reject = async function (rejectedBy, reason, options = {}) {
  if (this.status !== "submitted") throw new Error("Only submitted requests can be rejected");
  if (!reason?.trim()) throw new Error("Rejection reason is required");
  this.status = "rejected";
  this.rejectedAt = new Date();
  this.rejectedBy = rejectedBy;
  this.rejectionReason = reason;
  await this.save(options);
  return this;
};

leaveRequestSchema.methods.recall = async function (options = {}) {
  if (this.status !== "submitted") throw new Error("Only submitted requests can be recalled");
  this.status = "recalled";
  this.recalledAt = new Date();
  await this.save(options);
  return this;
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Auto-generate leave number: LV-2026-0001
 */
leaveRequestSchema.statics.generateLeaveNumber = async function (companyId, session = null) {
  const year = new Date().getFullYear();
  const counterName = `leave-${year}`;
  const seq = await ErpCounter.getNextSequence(counterName, companyId, session);
  return `LV-${year}-${String(seq).padStart(4, "0")}`;
};

/**
 * Check for overlapping approved leave for an employee
 * Used before approving to detect conflicts
 */
leaveRequestSchema.statics.hasOverlap = async function (companyId, partyId, fromDate, toDate, excludeId = null) {
  const query = {
    companyId,
    "employee.partyId": partyId,
    status: { $in: ["approved", "submitted"] },
    "dates.from": { $lte: toDate },
    "dates.to": { $gte: fromDate },
  };
  if (excludeId) query._id = { $ne: excludeId };
  const count = await this.countDocuments(query);
  return count > 0;
};

/**
 * Get leave requests pending approval (for manager/HR dashboard)
 */
leaveRequestSchema.statics.getPendingApproval = function (companyId) {
  return this.find({ companyId, status: "submitted" })
    .sort({ submittedAt: 1 })  // Oldest first
    .lean();
};

/**
 * Get employee's leave history
 */
leaveRequestSchema.statics.getEmployeeHistory = function (companyId, partyId, year = null) {
  const query = { companyId, "employee.partyId": partyId };
  if (year) {
    const start = new Date(`${year}-01-01`);
    const end = new Date(`${year}-12-31`);
    query["dates.from"] = { $gte: start, $lte: end };
  }
  return this.find(query).sort({ "dates.from": -1 }).lean();
};

/**
 * Get approved leaves in a date range (for leave calendar)
 */
leaveRequestSchema.statics.getCalendar = function (companyId, fromDate, toDate) {
  return this.find({
    companyId,
    status: { $in: ["approved", "completed"] },
    "dates.from": { $lte: toDate },
    "dates.to": { $gte: fromDate },
  })
    .select("employee leaveType dates status")
    .sort({ "dates.from": 1 })
    .lean();
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let LeaveRequest = models?.LeaveRequest;

if (!LeaveRequest) {
  LeaveRequest = mongoose.model("LeaveRequest", leaveRequestSchema);
}

export default LeaveRequest;
export { LeaveRequest };

import mongoose from "mongoose";
import { ErpCounter } from "./erp-counter";

const Schema = mongoose.Schema;

// ============================================
// DEPARTMENT SCHEMA
// ============================================
// Design:
// - Standalone collection — referenced via embedded snapshot everywhere else
//   (no $lookup needed: employees embed { departmentId, department } at write time)
// - head: embedded snapshot (name + partyId) — avoids lookup for org chart display
// - costCenter: embedded snapshot — avoids lookup when posting payroll to journals
// - parentDepartmentId: ref only (org hierarchy rarely queried, explicit lookup OK)
// ============================================

const departmentSchema = new Schema(
  {
    // Tenant isolation — always first in all indexes
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Auto-generated code: "DEPT001", "DEPT002"
    code: {
      type: String,
      required: [true, "Department code is required"],
      trim: true,
      uppercase: true,
      maxlength: [20, "Code cannot exceed 20 characters"],
    },

    name: {
      type: String,
      required: [true, "Department name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },

    // Department head — embedded snapshot (avoid $lookup on org chart)
    head: {
      partyId: { type: Schema.Types.ObjectId, ref: "Party" },
      name: String,
      employeeNumber: String,
      designation: String,
    },

    // Links to chart of accounts for cost center / payroll posting
    costCenter: {
      accountId: { type: Schema.Types.ObjectId, ref: "Account" },
      accountCode: String,
      accountName: String,
    },

    // Org hierarchy (optional) — explicit lookup acceptable (rare query)
    parentDepartmentId: {
      type: Schema.Types.ObjectId,
      ref: "Department",
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Audit trail (matches your existing pattern)
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
// Unique code per company
departmentSchema.index({ companyId: 1, code: 1 }, { unique: true });
// List queries
departmentSchema.index({ companyId: 1, isActive: 1, name: 1 });

// ============================================
// VIRTUALS
// ============================================
departmentSchema.virtual("hasHead").get(function () {
  return !!this.head?.partyId;
});

departmentSchema.virtual("hasCostCenter").get(function () {
  return !!this.costCenter?.accountId;
});

// ============================================
// STATIC METHODS
// ============================================

/**
 * Auto-generate department code: DEPT001, DEPT002, ...
 */
departmentSchema.statics.generateCode = async function (companyId, session = null) {
  const seq = await ErpCounter.getNextSequence("dept", companyId, session);
  return `DEPT${String(seq).padStart(3, "0")}`;
};

/**
 * Get all active departments for a company (for dropdowns / selects)
 * Returns lean — safe for client serialization
 */
departmentSchema.statics.getActive = function (companyId) {
  return this.find({ companyId, isActive: true })
    .sort({ name: 1 })
    .select("code name head costCenter")
    .lean();
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Department = models?.Department;

if (!Department) {
  Department = mongoose.model("Department", departmentSchema);
}

export default Department;
export { Department };

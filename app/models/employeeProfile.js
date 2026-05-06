import mongoose from "mongoose";
import { ErpCounter } from "./erp-counter";

const Schema = mongoose.Schema;

// ============================================
// EMPLOYEE PROFILE SCHEMA
// ============================================
// Design Principles:
//
// 1. SEPARATION FROM PARTY
//    Party (type=employee) = financial identity (claims, payroll payments, journals)
//    EmployeeProfile = HR data (personal info, compensation, leave balances, docs)
//    Linked via partyId (1:1). This keeps Party lean and HR data cohesive.
//
// 2. EMBEDDED vs REFERENCED
//    EMBED:  personalInfo, employment, compensation, emergencyContact
//            → One-to-one, always read together, never queried independently
//    EMBED:  leaveBalances (bounded: max ~10 leave types per company, fixed set)
//            → Atomic $inc updates via positional $ operator — no extra round-trip
//    EMBED:  documents[] — bounded cap at 50. For most SMBs this is sufficient.
//            Each doc ~200 bytes → 50 docs = 10KB well within 16MB limit.
//    NEVER embed: leaveRequests (unbounded), salary history (unbounded)
//
// 3. NO UNBOUNDED ARRAYS
//    leaveRequests → LeaveRequest collection (parent-ref to partyId)
//    salaryHistory → not tracked here; use PayrollEntry history if needed
//
// 4. DENORMALIZED SNAPSHOTS
//    employeeNumber, name, department stored here AND in LeaveRequest/PayrollEntry
//    snapshots at write time → zero $lookup in read paths
//
// 5. LEAVE BALANCE UPDATES
//    Use $inc with positional operator (no re-read needed):
//    updateOne({ _id, "leaveBalances.leaveType": "annual" },
//              { $inc: { "leaveBalances.$.usedDays": N, "leaveBalances.$.balanceDays": -N } })
// ============================================

// Sub-schema: leave balance per type (embedded, bounded)
// _id: false — no ObjectId overhead for embedded value objects
const leaveBalanceSchema = new Schema(
  {
    leaveType: {
      type: String,
      required: true,
    },
    label: String,         // "Annual Leave" — for display without enum mapping
    entitledDays: {        // Days allocated per year
      type: Number,
      default: 0,
      min: 0,
    },
    usedDays: {            // Days taken (approved + past)
      type: Number,
      default: 0,
      min: 0,
    },
    pendingDays: {         // Applied but awaiting approval
      type: Number,
      default: 0,
      min: 0,
    },
    balanceDays: {         // = entitledDays + carryOver - usedDays
      type: Number,
      default: 0,
    },
    carryOver: {           // Days carried forward from previous year
      type: Number,
      default: 0,
      min: 0,
    },
    year: {
      type: Number,
      required: true,
    },
  },
  { _id: false }           // No ObjectId — pure value object
);

const employeeProfileSchema = new Schema(
  {
    // Tenant isolation
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // ============================================
    // LINKS TO EXISTING RECORDS
    // ============================================
    // Party holds financial identity — do NOT duplicate financial fields here
    partyId: {
      type: Schema.Types.ObjectId,
      ref: "Party",
      required: [true, "Party ID is required"],
      index: true,
    },

    // System login access (optional — not all employees have logins)
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      sparse: true,
      index: true,
    },

    // Denormalized for fast lookups — kept in sync with Party.employeeNumber
    employeeNumber: {
      type: String,
      trim: true,
      uppercase: true,
      index: true,
    },

    // ============================================
    // PERSONAL INFORMATION (embedded — one-to-one)
    // ============================================
    personalInfo: {
      firstName: {
        type: String,
        required: [true, "First name is required"],
        trim: true,
      },
      lastName: {
        type: String,
        required: [true, "Last name is required"],
        trim: true,
      },
      dateOfBirth: Date,
      gender: {
        type: String,
        enum: ["male", "female", "other"],
      },
      nationalId: {
        type: String,
        trim: true,
        // Kenya National ID (8 digits)
      },
      kraPin: {
        type: String,
        trim: true,
        uppercase: true,
        // Kenya KRA PIN: A000000000X format
      },
      nssfNumber: {
        type: String,
        trim: true,
        // National Social Security Fund
      },
      shaNumber: {
        type: String,
        trim: true,
        // Social Health Authority (replaced NHIF Oct 2024)
      },
      passportNumber: {
        type: String,
        trim: true,
      },
      nationality: {
        type: String,
        default: "Kenyan",
      },
      photo: {
        url: String,
        publicId: String,  // Cloudinary public ID (for deletion)
      },
    },

    // ============================================
    // EMPLOYMENT (embedded — one-to-one)
    // ============================================
    employment: {
      // Department snapshot — embedded to avoid $lookup on employee list
      departmentId: {
        type: Schema.Types.ObjectId,
        ref: "Department",
        index: true,
      },
      department: String,       // Snapshot: "Finance" — updated on dept name change

      designation: {
        type: String,           // "Senior Accountant", "Warehouse Manager"
        trim: true,
      },

      employmentType: {
        type: String,
        enum: ["full_time", "part_time", "contract", "intern", "casual"],
        default: "full_time",
      },

      status: {
        type: String,
        enum: ["active", "probation", "on_leave", "suspended", "terminated"],
        default: "probation",
        index: true,
      },

      hireDate: {
        type: Date,
        required: [true, "Hire date is required"],
      },

      confirmationDate: Date,   // End of probation
      terminationDate: Date,

      // Contract management (for contract/casual employees)
      contractStart: Date,
      contractEnd: Date,        // Alert HR 30 days before expiry
      contractType: String,     // "fixed_term", "renewable", "project_based"

      // Reporting line — embedded snapshot
      managerId: {
        type: Schema.Types.ObjectId,
        ref: "Party",           // Party (type=employee)
      },
      managerName: String,      // Snapshot

      workLocation: String,     // "Nairobi HQ", "Mombasa Branch"
      jobGrade: String,         // "G1", "G2", "M1" — salary band reference

      // Per-employee shift override — null = use company AttendanceConfig default
      shiftStart: { type: String, default: null }, // "HH:MM" e.g. "08:00"
      shiftEnd:   { type: String, default: null }, // "HH:MM" e.g. "17:00"
    },

    // ============================================
    // COMPENSATION (embedded — current only)
    // ============================================
    // Salary history → NOT stored here (unbounded). Use PayrollEntry as history.
    compensation: {
      basicSalary: {
        type: Number,
        default: 0,
        min: [0, "Salary cannot be negative"],
      },
      currency: {
        type: String,
        default: "KES",
        uppercase: true,
      },

      // Allowances (fixed monthly)
      allowances: {
        housing: { type: Number, default: 0 },
        transport: { type: Number, default: 0 },
        medical: { type: Number, default: 0 },
        other: { type: Number, default: 0 },
      },

      // Payment method
      paymentMethod: {
        type: String,
        enum: ["bank", "mpesa", "cash"],
        default: "bank",
      },
      bankName: String,
      bankAccount: String,
      bankBranch: String,
      mpesaNumber: String,

      // Track when salary last changed (for audit, not full history)
      lastReviewDate: Date,
      lastReviewedBy: { name: String, id: String },
    },

    // ============================================
    // LEAVE BALANCES (embedded — bounded)
    // ============================================
    // Bounded: company defines a fixed set of leave types (~5-10 max)
    // Updated atomically with positional $ operator — no re-read required:
    //   updateOne(
    //     { _id: profileId, "leaveBalances.leaveType": "annual" },
    //     { $inc: { "leaveBalances.$.usedDays": days, "leaveBalances.$.balanceDays": -days } }
    //   )
    leaveBalances: {
      type: [leaveBalanceSchema],
      default: [],
      validate: {
        validator: (v) => v.length <= 15,
        message: "Cannot exceed 15 leave type configurations",
      },
    },

    // ============================================
    // EMERGENCY CONTACT (embedded — one-to-one)
    // ============================================
    emergencyContact: {
      name: String,
      relationship: String,     // "Spouse", "Parent", "Sibling"
      phone: String,
      alternatePhone: String,
    },

    // ============================================
    // DOCUMENTS (embedded — bounded at 50)
    // ============================================
    // 50 docs × ~200 bytes each = ~10KB per employee — well within 16MB
    // For large file-heavy use cases, move to a separate collection
    documents: {
      type: [
        {
          docType: {
            type: String,
            required: true,
            // "contract", "national_id", "certificate", "academic", "medical"
          },
          name: String,
          url: String,
          publicId: String,     // Cloudinary public ID
          expiryDate: Date,
          uploadedAt: { type: Date, default: Date.now },
          uploadedBy: { name: String, id: String },
        },
      ],
      default: [],
      validate: {
        validator: (v) => v.length <= 50,
        message: "Cannot store more than 50 documents per employee",
      },
    },

    notes: {
      type: String,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
    },

    // Audit trail (matches existing pattern)
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
// One profile per Party per company
employeeProfileSchema.index({ companyId: 1, partyId: 1 }, { unique: true });
// Hot query paths — all prefixed with companyId for tenant isolation
employeeProfileSchema.index({ companyId: 1, "employment.departmentId": 1, "employment.status": 1 });
employeeProfileSchema.index({ companyId: 1, "employment.status": 1 });
employeeProfileSchema.index({ companyId: 1, employeeNumber: 1 });
// Sparse: only index when userId exists
employeeProfileSchema.index({ companyId: 1, userId: 1 }, { sparse: true });

// ============================================
// VIRTUALS
// ============================================
employeeProfileSchema.virtual("fullName").get(function () {
  const first = this.personalInfo?.firstName || "";
  const last = this.personalInfo?.lastName || "";
  return `${first} ${last}`.trim();
});

employeeProfileSchema.virtual("isActive").get(function () {
  return this.employment?.status === "active";
});

employeeProfileSchema.virtual("isOnProbation").get(function () {
  return this.employment?.status === "probation";
});

employeeProfileSchema.virtual("grossSalary").get(function () {
  const comp = this.compensation;
  if (!comp) return 0;
  return (
    (comp.basicSalary || 0) +
    (comp.allowances?.housing || 0) +
    (comp.allowances?.transport || 0) +
    (comp.allowances?.medical || 0) +
    (comp.allowances?.other || 0)
  );
});

employeeProfileSchema.virtual("annualLeaveBalance").get(function () {
  const balance = this.leaveBalances?.find((b) => b.leaveType === "annual");
  return balance?.balanceDays ?? null;
});

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Get leave balance for a specific type
 */
employeeProfileSchema.methods.getLeaveBalance = function (leaveType) {
  return this.leaveBalances?.find((b) => b.leaveType === leaveType) || null;
};

/**
 * Check if employee has sufficient leave balance
 */
employeeProfileSchema.methods.hasSufficientLeave = function (leaveType, days) {
  const balance = this.getLeaveBalance(leaveType);
  if (!balance) return false;
  return (balance.balanceDays - balance.pendingDays) >= days;
};

/**
 * Initialize default leave balances for a new year
 * Call once at year start or on employee creation
 */
employeeProfileSchema.methods.initLeaveBalances = function (year, leavePolicy) {
  // leavePolicy: [{ leaveType, label, entitledDays, carryOver }]
  this.leaveBalances = leavePolicy.map((policy) => ({
    leaveType: policy.leaveType,
    label: policy.label,
    entitledDays: policy.entitledDays,
    carryOver: policy.carryOver || 0,
    usedDays: 0,
    pendingDays: 0,
    balanceDays: policy.entitledDays + (policy.carryOver || 0),
    year,
  }));
  return this;
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Auto-generate employee number: EMP001, EMP002, ...
 */
employeeProfileSchema.statics.generateEmployeeNumber = async function (companyId, session = null) {
  const seq = await ErpCounter.getNextSequence("emp", companyId, session);
  return `EMP${String(seq).padStart(4, "0")}`;
};

/**
 * Get employees for a department (lean — for lists)
 */
employeeProfileSchema.statics.getByDepartment = function (companyId, departmentId) {
  return this.find({
    companyId,
    "employment.departmentId": departmentId,
    "employment.status": { $ne: "terminated" },
  })
    .select("employeeNumber personalInfo.firstName personalInfo.lastName employment compensation.basicSalary")
    .sort({ "personalInfo.lastName": 1 })
    .lean();
};

/**
 * Get active employee count per department (for dashboard widget)
 */
employeeProfileSchema.statics.getHeadcountByDepartment = async function (companyId) {
  return this.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        "employment.status": { $in: ["active", "probation"] },
      },
    },
    {
      $group: {
        _id: "$employment.departmentId",
        department: { $first: "$employment.department" },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);
};

/**
 * Atomically debit leave balance (when leave is approved)
 * Uses positional $ operator — single atomic write, no re-read
 */
employeeProfileSchema.statics.debitLeave = async function (
  profileId,
  leaveType,
  days,
  session = null
) {
  const options = session ? { session, new: true } : { new: true };
  return this.findOneAndUpdate(
    { _id: profileId, "leaveBalances.leaveType": leaveType },
    {
      $inc: {
        "leaveBalances.$.usedDays": days,
        "leaveBalances.$.balanceDays": -days,
        "leaveBalances.$.pendingDays": -days, // Remove from pending on approval
      },
    },
    options
  );
};

/**
 * Atomically mark leave as pending (when leave request submitted)
 */
employeeProfileSchema.statics.markLeavePending = async function (
  profileId,
  leaveType,
  days,
  session = null
) {
  const options = session ? { session, new: true } : { new: true };
  return this.findOneAndUpdate(
    { _id: profileId, "leaveBalances.leaveType": leaveType },
    { $inc: { "leaveBalances.$.pendingDays": days } },
    options
  );
};

/**
 * Release pending leave (when leave request cancelled/rejected)
 */
employeeProfileSchema.statics.releasePendingLeave = async function (
  profileId,
  leaveType,
  days,
  session = null
) {
  const options = session ? { session, new: true } : { new: true };
  return this.findOneAndUpdate(
    { _id: profileId, "leaveBalances.leaveType": leaveType },
    { $inc: { "leaveBalances.$.pendingDays": -days } },
    options
  );
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let EmployeeProfile = models?.EmployeeProfile;

if (!EmployeeProfile) {
  EmployeeProfile = mongoose.model("EmployeeProfile", employeeProfileSchema);
}

export default EmployeeProfile;
export { EmployeeProfile };

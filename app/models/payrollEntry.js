import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// PAYROLL ENTRY SCHEMA (Per-employee per-run)
// ============================================
// Design:
// - One document per employee per payroll run.
// - References PayrollRun via payrollRunId (parent reference).
//   Query pattern: PayrollEntry.find({ payrollRunId }) — indexed for performance.
//
// - Also queryable per employee: PayrollEntry.find({ partyId })
//   → serves as salary history without a dedicated collection.
//
// - Employee snapshot embedded (name, number, department):
//   Avoids $lookup when generating payslips or exporting bank files.
//
// - Earnings and deductions are explicit fields (not a generic array):
//   Reason: structured fields allow aggregation ($sum, $group by field)
//   without needing $unwind on arrays. Much cheaper for payroll reports.
//
// - Kenya-specific deductions: PAYE, NSSF, SHIF (formerly NHIF, Oct 2024)
//   These are mandatory and have fixed statutory rates — explicit fields
//   are clearer than a generic deductions array.
//
// - additionalEarnings / additionalDeductions: capped arrays (~10 items max)
//   for bonuses, commissions, one-off deductions that don't fit fixed fields.
// ============================================

// Sub-schema for additional earnings/deductions (bounded: max 10 each)
const lineItemSchema = new Schema(
  {
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    accountId: { type: Schema.Types.ObjectId, ref: "Account" }, // Optional GL account
    accountCode: String,
    accountName: String,
  },
  { _id: false }
);

const payrollEntrySchema = new Schema(
  {
    // Tenant isolation
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Parent reference to PayrollRun
    payrollRunId: {
      type: Schema.Types.ObjectId,
      ref: "PayrollRun",
      required: [true, "Payroll run ID is required"],
      index: true,
    },

    // Period snapshot (denormalized for fast per-employee history queries)
    period: {
      month: Number,
      year: Number,
      label: String,  // "March 2026"
    },

    // ============================================
    // EMPLOYEE SNAPSHOT (avoids $lookup on payslip generation)
    // ============================================
    partyId: {
      type: Schema.Types.ObjectId,
      ref: "Party",
      required: [true, "Party ID is required"],
      index: true,
    },
    profileId: {
      type: Schema.Types.ObjectId,
      ref: "EmployeeProfile",
      required: [true, "Profile ID is required"],
    },
    employeeNumber: String,
    employeeName: String,
    department: String,
    designation: String,
    employmentType: String,  // Affects NSSF/SHIF calculations

    // ============================================
    // EARNINGS (explicit fields — enables field-level aggregation)
    // ============================================
    earnings: {
      basicSalary: { type: Number, default: 0, min: 0 },

      // Fixed allowances
      housingAllowance: { type: Number, default: 0, min: 0 },
      transportAllowance: { type: Number, default: 0, min: 0 },
      medicalAllowance: { type: Number, default: 0, min: 0 },
      otherAllowance: { type: Number, default: 0, min: 0 },

      // Variable
      overtime: { type: Number, default: 0, min: 0 },
      bonus: { type: Number, default: 0, min: 0 },
      commission: { type: Number, default: 0, min: 0 },

      // One-off additions (bounded: max 10)
      additional: {
        type: [lineItemSchema],
        default: [],
        validate: {
          validator: (v) => v.length <= 10,
          message: "Cannot have more than 10 additional earnings",
        },
      },

      // Calculated total
      grossPay: { type: Number, default: 0, min: 0 },
    },

    // ============================================
    // DEDUCTIONS (explicit statutory + bounded additional)
    // ============================================
    deductions: {
      // Kenya statutory — employee side
      paye: { type: Number, default: 0, min: 0 },          // Income tax (KRA PAYE)
      nssf: { type: Number, default: 0, min: 0 },          // Pension employee share
      shif: { type: Number, default: 0, min: 0 },          // SHIF (replaced NHIF Oct 2024) — flat % of gross
      housingLevy: { type: Number, default: 0, min: 0 },   // Affordable Housing Levy employee share

      // Insurance relief — 15% of SHIF contribution, capped at KES 5,000/month.
      // Reduces PAYE payable; stored for payslip display and audit.
      insuranceRelief: { type: Number, default: 0, min: 0 },

      // Common recurring
      loanRepayment: { type: Number, default: 0, min: 0 }, // Salary advance recovery
      saccoDeduction: { type: Number, default: 0, min: 0 }, // SACCO contributions

      // One-off deductions (bounded: max 10)
      additional: {
        type: [lineItemSchema],
        default: [],
        validate: {
          validator: (v) => v.length <= 10,
          message: "Cannot have more than 10 additional deductions",
        },
      },

      // Calculated total (employee deductions only)
      totalDeductions: { type: Number, default: 0, min: 0 },
    },

    // ============================================
    // EMPLOYER CONTRIBUTIONS
    // ============================================
    // Not deducted from employee — tracked for remittance reports (NSSF, AHL).
    employerContributions: {
      nssf: { type: Number, default: 0, min: 0 },       // NSSF employer share (mirrors employee)
      housingLevy: { type: Number, default: 0, min: 0 }, // AHL employer share
    },

    // ============================================
    // NET PAY
    // ============================================
    netPay: { type: Number, default: 0, min: 0 },  // grossPay - totalDeductions

    currency: { type: String, default: "KES", uppercase: true },

    // ============================================
    // PAYMENT STATUS
    // ============================================
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "on_hold"],
      default: "pending",
      index: true,
    },

    paidAt: Date,
    paymentMethod: {
      type: String,
      enum: ["bank", "mpesa", "cash"],
    },
    paymentReference: String,  // Bank transfer ref, M-Pesa code

    // ============================================
    // PAYSLIP
    // ============================================
    payslipUrl: String,        // Generated PDF URL
    payslipSentAt: Date,

    // Working days in period (for pro-rata calculations)
    workingDays: {
      total: Number,           // Total working days in month
      worked: Number,          // Days actually worked (after leave deductions)
    },

    // ============================================
    // PAYMENT DETAILS SNAPSHOT
    // ============================================
    // Snapshotted from EmployeeProfile.compensation at generation time.
    // Stored here so bank/M-Pesa exports don't need a $lookup.
    bankName: String,
    bankBranch: String,
    bankAccount: String,
    mpesaNumber: String,

    notes: {
      type: String,
      maxlength: [300, "Notes cannot exceed 300 characters"],
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
// One entry per employee per run (prevents duplicates)
payrollEntrySchema.index({ payrollRunId: 1, partyId: 1 }, { unique: true });
// Fetch all entries for a run (most common read path)
payrollEntrySchema.index({ companyId: 1, payrollRunId: 1 });
// Employee salary history (secondary read path)
payrollEntrySchema.index({ companyId: 1, partyId: 1, "period.year": -1, "period.month": -1 });
// Payment batch queries
payrollEntrySchema.index({ payrollRunId: 1, paymentStatus: 1 });

// ============================================
// VIRTUALS
// ============================================
payrollEntrySchema.virtual("isPaid").get(function () {
  return this.paymentStatus === "paid";
});

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Recalculate totals from component fields
 * Call after modifying earnings or deductions before saving
 */
payrollEntrySchema.methods.recalculate = function () {
  const e = this.earnings;
  const additionalEarnings = (e.additional || []).reduce((s, i) => s + i.amount, 0);

  e.grossPay =
    (e.basicSalary || 0) +
    (e.housingAllowance || 0) +
    (e.transportAllowance || 0) +
    (e.medicalAllowance || 0) +
    (e.otherAllowance || 0) +
    (e.overtime || 0) +
    (e.bonus || 0) +
    (e.commission || 0) +
    additionalEarnings;

  const d = this.deductions;
  const additionalDeductions = (d.additional || []).reduce((s, i) => s + i.amount, 0);

  d.totalDeductions =
    (d.paye || 0) +
    (d.nssf || 0) +
    (d.shif || 0) +
    (d.housingLevy || 0) +
    (d.loanRepayment || 0) +
    (d.saccoDeduction || 0) +
    additionalDeductions;

  this.netPay = e.grossPay - d.totalDeductions;

  return this;
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get all entries for a payroll run (lean — for payroll review screen)
 */
payrollEntrySchema.statics.getRunEntries = function (payrollRunId) {
  return this.find({ payrollRunId })
    .sort({ employeeName: 1 })
    .lean();
};

/**
 * Get entries pending payment for a run (for bank export)
 */
payrollEntrySchema.statics.getPendingPayment = function (payrollRunId) {
  return this.find({ payrollRunId, paymentStatus: "pending" })
    .select("partyId employeeNumber employeeName netPay paymentMethod bankAccount mpesaNumber")
    .lean();
};

/**
 * Aggregate totals for a run (for PayrollRun.totals sync)
 * Returns a single object with summed fields
 */
payrollEntrySchema.statics.aggregateTotals = async function (payrollRunId) {
  const result = await this.aggregate([
    { $match: { payrollRunId: new mongoose.Types.ObjectId(payrollRunId) } },
    {
      $group: {
        _id: null,
        employeeCount: { $sum: 1 },
        totalBasicSalary: { $sum: "$earnings.basicSalary" },
        totalAllowances: {
          $sum: {
            $add: [
              "$earnings.housingAllowance",
              "$earnings.transportAllowance",
              "$earnings.medicalAllowance",
              "$earnings.otherAllowance",
            ],
          },
        },
        totalGrossPay: { $sum: "$earnings.grossPay" },
        totalPAYE: { $sum: "$deductions.paye" },
        totalNSSF: { $sum: "$deductions.nssf" },
        totalSHIF: { $sum: "$deductions.shif" },
        totalHousingLevy: { $sum: "$deductions.housingLevy" },
        totalOtherDeductions: {
          $sum: {
            $add: ["$deductions.loanRepayment", "$deductions.saccoDeduction"],
          },
        },
        totalEmployerNSSF: { $sum: "$employerContributions.nssf" },
        totalEmployerAHL: { $sum: "$employerContributions.housingLevy" },
        totalDeductions: { $sum: "$deductions.totalDeductions" },
        totalNetPay: { $sum: "$netPay" },
      },
    },
  ]);
  return result[0] || null;
};

/**
 * Get employee's payroll history (acts as salary history)
 */
payrollEntrySchema.statics.getEmployeeHistory = function (companyId, partyId, limit = 12) {
  return this.find({ companyId, partyId })
    .sort({ "period.year": -1, "period.month": -1 })
    .limit(limit)
    .select("payrollRunId period earnings.grossPay deductions.totalDeductions netPay paymentStatus")
    .lean();
};

// ============================================
// PRE-SAVE: Auto-recalculate on save
// ============================================
payrollEntrySchema.pre("save", function (next) {
  this.recalculate();
  next();
});

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let PayrollEntry = models?.PayrollEntry;

if (!PayrollEntry) {
  PayrollEntry = mongoose.model("PayrollEntry", payrollEntrySchema);
}

export default PayrollEntry;
export { PayrollEntry };

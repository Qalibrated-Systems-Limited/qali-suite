import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// PAYROLL CONFIG SCHEMA
// ============================================
// Stores statutory deduction rates and tax brackets per company,
// with effective date ranges so historical payrolls remain reproducible.
//
// Only ONE config is "active" at a time per company (isActive: true).
// When Finance Act changes rates (typically July each year), Admin:
//   1. Creates a new config with the new rates + new effectiveFrom date.
//   2. The new config becomes active; the old one is archived (isActive: false).
//
// generatePayrollEntries reads the active config at run time.
// Historical re-runs use the config that was active during that period.
//
// IMPORTANT: All rate fields store decimals (e.g. 0.0275 = 2.75%).
//            PAYE brackets store annual taxable income in KES.
// ============================================

// PAYE tax bracket (annual taxable income)
const payeBracketSchema = new Schema(
  {
    from: { type: Number, required: true, min: 0 },  // Lower bound (inclusive)
    to: { type: Number, default: null },              // Upper bound (null = no ceiling)
    rate: { type: Number, required: true, min: 0, max: 1 }, // e.g. 0.1 = 10%
  },
  { _id: false }
);

const payrollConfigSchema = new Schema(
  {
    // Tenant isolation
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Human-readable name for the config (e.g. "FY 2024/2025 — Finance Act")
    name: {
      type: String,
      required: [true, "Config name is required"],
      trim: true,
    },

    // Effective period (this config applies when payroll period falls within this range)
    effectiveFrom: {
      type: Date,
      required: [true, "Effective from date is required"],
    },
    effectiveTo: {
      type: Date,
      default: null,  // null = currently active / no end date
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
    },

    // ============================================
    // PAYE (Pay As You Earn — KRA)
    // ============================================
    // Brackets based on ANNUAL taxable income (gross - NSSF employee deduction).
    // Payroll engine divides annual tax by 12 for monthly PAYE.
    payeBrackets: {
      type: [payeBracketSchema],
      default: [],
      validate: {
        validator: (v) => v.length >= 1,
        message: "At least one PAYE bracket is required",
      },
    },

    // Personal Relief — monthly amount that directly reduces PAYE (not a deduction from income)
    personalRelief: {
      type: Number,
      required: true,
      min: 0,
      // e.g. 2400 (KES 2,400/month as at 2024)
    },

    // Insurance Relief — % of insurance premiums paid; reduces PAYE; subject to monthly cap
    insuranceReliefRate: {
      type: Number,
      default: 0.15,  // 15%
      min: 0,
      max: 1,
    },
    insuranceReliefCap: {
      type: Number,
      default: 5000,  // KES 5,000/month max
      min: 0,
    },

    // ============================================
    // NSSF (National Social Security Fund)
    // ============================================
    // Tier I: applies on earnings up to LEL (Lower Earnings Limit)
    // Tier II: applies on earnings from LEL up to UEL (Upper Earnings Limit)
    // Both employee and employer contribute the same rates.
    nssfTierILimit: {
      type: Number,
      required: true,
      min: 0,
      // e.g. 6000 (KES 6,000 LEL)
    },
    nssfTierIILimit: {
      type: Number,
      required: true,
      min: 0,
      // e.g. 18000 (KES 18,000 UEL)
    },
    nssfEmployeeRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      // e.g. 0.06 (6%)
    },
    nssfEmployerRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      // e.g. 0.06 (6%) — tracked for remittance reports, not deducted from employee
    },

    // ============================================
    // SHIF (Social Health Insurance Fund)
    // ============================================
    // Replaced NHIF from October 2024.
    // Flat rate on gross pay — no minimum, no cap, no graduated scale.
    // Only employee contributes (no employer match for SHIF).
    shifRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      // e.g. 0.0275 (2.75% of gross)
    },

    // ============================================
    // AFFORDABLE HOUSING LEVY (AHL)
    // ============================================
    // Mandatory from March 2024 (Affordable Housing Act).
    // Both employee and employer contribute.
    ahlEmployeeRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      // e.g. 0.015 (1.5% of gross)
    },
    ahlEmployerRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      // e.g. 0.015 (1.5% of gross) — tracked for remittance, not deducted from employee
    },

    notes: {
      type: String,
      maxlength: [500, "Notes cannot exceed 500 characters"],
    },

    // ============================================
    // GL MAPPING (Phase 7 — GL Integration)
    // ============================================
    // Maps payroll line items to GL accounts for automatic journal posting.
    // All fields are optional — if a mapping is absent, GL posting is skipped
    // for that component (approval/payment still proceed normally).
    //
    // ON APPROVE — Payroll accrual journal:
    //   Dr salaryExpense       = totalGrossPay
    //   Dr employerNssfExpense = totalEmployerNSSF
    //   Dr employerAhlExpense  = totalEmployerAHL
    //   Cr payePayable         = totalPAYE
    //   Cr nssfPayable         = totalNSSF + totalEmployerNSSF
    //   Cr shifPayable         = totalSHIF
    //   Cr ahlPayable          = totalHousingLevy + totalEmployerAHL
    //   Cr salaryPayable       = totalNetPay
    //
    // ON PAID — Payment clearing journal:
    //   Dr salaryPayable       = totalNetPay
    //   Cr bankAccount         = totalNetPay
    // ============================================
    glMapping: {
      // Expense accounts (debited on approve)
      salaryExpense:        { type: Schema.Types.ObjectId, ref: "Account" },
      employerNssfExpense:  { type: Schema.Types.ObjectId, ref: "Account" },
      employerAhlExpense:   { type: Schema.Types.ObjectId, ref: "Account" },
      // Liability accounts (credited on approve, debited on remittance)
      salaryPayable:        { type: Schema.Types.ObjectId, ref: "Account" },
      payePayable:          { type: Schema.Types.ObjectId, ref: "Account" },
      nssfPayable:          { type: Schema.Types.ObjectId, ref: "Account" },
      shifPayable:          { type: Schema.Types.ObjectId, ref: "Account" },
      ahlPayable:           { type: Schema.Types.ObjectId, ref: "Account" },
      // Bank account (credited on paid)
      bankAccount:          { type: Schema.Types.ObjectId, ref: "Account" },
      // Loan accounts
      staffLoansReceivable: { type: Schema.Types.ObjectId, ref: "Account" },
      interestIncome:       { type: Schema.Types.ObjectId, ref: "Account" },
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
// Only one active config per company at a time (enforced in application logic,
// not DB unique index — allows transitioning between configs)
payrollConfigSchema.index({ companyId: 1, isActive: 1 });
payrollConfigSchema.index({ companyId: 1, effectiveFrom: -1 });

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get the active payroll config for a company.
 * Falls back to the most recently created config if none marked active.
 */
payrollConfigSchema.statics.getActive = async function (companyId) {
  const active = await this.findOne({ companyId, isActive: true }).sort({ effectiveFrom: -1 }).lean();
  if (active) return active;
  // Fallback: most recent config regardless of isActive flag
  return this.findOne({ companyId }).sort({ createdAt: -1 }).lean();
};

/**
 * Get the config that was active for a specific payroll period (month/year).
 * Used when reproducing historical payrolls.
 */
payrollConfigSchema.statics.getForPeriod = async function (companyId, year, month) {
  const periodStart = new Date(year, month - 1, 1);
  return this.findOne({
    companyId,
    effectiveFrom: { $lte: periodStart },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: periodStart } }],
  })
    .sort({ effectiveFrom: -1 })
    .lean();
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let PayrollConfig = models?.PayrollConfig;

if (!PayrollConfig) {
  PayrollConfig = mongoose.model("PayrollConfig", payrollConfigSchema);
}

export default PayrollConfig;
export { PayrollConfig };

import mongoose from "mongoose";
import { ErpCounter } from "./erp-counter";

const Schema = mongoose.Schema;

// ============================================
// PAYROLL RUN SCHEMA (Header / Run metadata)
// ============================================
// Design:
// - PayrollRun stores ONLY the run header: period, status, totals, approvals.
// - Employee entries live in PayrollEntry (separate collection, parent-ref here).
//   Why separate? A company with 500 employees × ~1KB per entry = 500KB per run.
//   More importantly: entries are written incrementally and edited individually,
//   making them a poor fit for embedding in a single document.
//
// - No entries[] array here → zero unbounded-array risk.
//
// - Status flow:
//   draft → processing → review → approved → posted → paid
//   Any stage → voided (admin only, with reason)
//
// - Accounting integration:
//   When posted → creates JournalEntry (Salary Expense Dr / Payables Cr)
//   When paid   → creates Payment records per employee
// ============================================

const payrollRunSchema = new Schema(
  {
    // Tenant isolation
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Auto-generated: "PR-202603"
    payrollNumber: {
      type: String,
      required: [true, "Payroll number is required"],
    },

    // ============================================
    // PERIOD
    // ============================================
    period: {
      month: {
        type: Number,
        required: [true, "Month is required"],
        min: 1,
        max: 12,
      },
      year: {
        type: Number,
        required: [true, "Year is required"],
        min: 2020,
      },
      from: Date,   // e.g. 2026-03-01
      to: Date,     // e.g. 2026-03-31
      label: String, // "March 2026" — cached for display
    },

    // Scope (optional: run payroll for a specific department only)
    scope: {
      type: String,
      enum: ["all", "department"],
      default: "all",
    },
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "Department",
    },
    departmentName: String,

    // ============================================
    // AGGREGATE TOTALS (updated as entries are processed)
    // ============================================
    totals: {
      employeeCount: { type: Number, default: 0 },
      totalBasicSalary: { type: Number, default: 0 },
      totalAllowances: { type: Number, default: 0 },
      totalGrossPay: { type: Number, default: 0 },
      // Employee statutory deductions
      totalPAYE: { type: Number, default: 0 },
      totalNSSF: { type: Number, default: 0 },
      totalSHIF: { type: Number, default: 0 },         // Replaced NHIF (Oct 2024)
      totalHousingLevy: { type: Number, default: 0 },  // Affordable Housing Levy (employee)
      totalOtherDeductions: { type: Number, default: 0 },
      totalDeductions: { type: Number, default: 0 },
      totalNetPay: { type: Number, default: 0 },
      // Employer contributions (not deducted from employees — for remittance tracking)
      totalEmployerNSSF: { type: Number, default: 0 },
      totalEmployerAHL: { type: Number, default: 0 },
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
    },

    // ============================================
    // STATUS & WORKFLOW
    // ============================================
    status: {
      type: String,
      enum: {
        values: ["draft", "processing", "review", "approved", "posted", "paid", "voided"],
        message: "{VALUE} is not a valid payroll status",
      },
      default: "draft",
      index: true,
    },

    // Approval chain
    preparedBy: { name: String, id: String },
    preparedAt: Date,

    reviewedBy: { name: String, id: String },
    reviewedAt: Date,

    approvedBy: { name: String, id: String },
    approvedAt: Date,

    postedBy: { name: String, id: String },
    postedAt: Date,

    paidBy: { name: String, id: String },
    paidAt: Date,

    voidedBy: { name: String, id: String },
    voidedAt: Date,
    voidReason: String,

    // ============================================
    // ACCOUNTING LINKS
    // ============================================
    journalEntryIds: [{ type: Schema.Types.ObjectId, ref: "JournalEntry" }],

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
// Unique payroll number per company
payrollRunSchema.index({ companyId: 1, payrollNumber: 1 }, { unique: true });
// One run per period per company (prevent duplicate months)
payrollRunSchema.index({ companyId: 1, "period.year": 1, "period.month": 1 }, { unique: true });
// List queries
payrollRunSchema.index({ companyId: 1, status: 1, "period.year": -1 });

// ============================================
// VIRTUALS
// ============================================
payrollRunSchema.virtual("isDraft").get(function () {
  return this.status === "draft";
});

payrollRunSchema.virtual("isPosted").get(function () {
  return this.status === "posted" || this.status === "paid";
});

payrollRunSchema.virtual("canEdit").get(function () {
  return ["draft", "processing", "review"].includes(this.status);
});

// ============================================
// STATIC METHODS
// ============================================

/**
 * Auto-generate payroll number: PR-202603
 */
payrollRunSchema.statics.generatePayrollNumber = async function (companyId, month, year, session = null) {
  const monthStr = String(month).padStart(2, "0");
  const counterName = `payroll-${year}${monthStr}`;
  const seq = await ErpCounter.getNextSequence(counterName, companyId, session);
  return `PR-${year}${monthStr}-${String(seq).padStart(3, "0")}`;
};

/**
 * Check if a payroll run already exists for a period
 */
payrollRunSchema.statics.existsForPeriod = async function (companyId, month, year) {
  const count = await this.countDocuments({
    companyId,
    "period.month": month,
    "period.year": year,
    status: { $ne: "voided" },
  });
  return count > 0;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let PayrollRun = models?.PayrollRun;

if (!PayrollRun) {
  PayrollRun = mongoose.model("PayrollRun", payrollRunSchema);
}

export default PayrollRun;
export { PayrollRun };

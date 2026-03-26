import mongoose from "mongoose";
import ErpCounter from "./erp-counter";

const Schema = mongoose.Schema;

// ============================================
// INSTALLMENT SUB-SCHEMA
// ============================================
const installmentSchema = new Schema(
  {
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    principal: { type: Number, required: true, min: 0 },
    interest: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["pending", "deducted", "skipped"],
      default: "pending",
    },
    payrollRunId: { type: Schema.Types.ObjectId, ref: "PayrollRun" },
    paidAt: Date,
  },
  { _id: false }
);

// ============================================
// LOAN SCHEMA
// ============================================
const loanSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    loanNumber: { type: String, required: true },

    loanType: {
      type: String,
      enum: ["salary_advance", "staff_loan", "sacco_deduction"],
      required: true,
    },

    // Employee link
    partyId: {
      type: Schema.Types.ObjectId,
      ref: "Party",
      required: true,
      index: true,
    },
    profileId: { type: Schema.Types.ObjectId, ref: "EmployeeProfile" },
    employeeName: { type: String, required: true },
    employeeNumber: String,
    department: String,

    // Terms
    principalAmount: { type: Number, required: true, min: 1 },
    interestRate: { type: Number, default: 0, min: 0, max: 1 }, // annual rate as decimal
    interestType: {
      type: String,
      enum: ["none", "flat", "reducing_balance"],
      default: "none",
    },
    tenure: { type: Number, required: true, min: 1, max: 120 }, // months
    monthlyInstallment: { type: Number, min: 0 },
    startMonth: { type: Number, required: true, min: 1, max: 12 },
    startYear: { type: Number, required: true },

    // Running totals
    totalRepaid: { type: Number, default: 0 },
    totalInterestPaid: { type: Number, default: 0 },
    outstandingBalance: { type: Number, default: 0 },

    // Schedule
    installments: [installmentSchema],

    // Status
    status: {
      type: String,
      enum: [
        "pending_approval",
        "approved",
        "disbursed",
        "active",
        "fully_repaid",
        "rejected",
        "cancelled",
      ],
      default: "pending_approval",
      index: true,
    },

    // Workflow
    requestedAt: { type: Date, default: Date.now },
    requestedBy: { name: String, id: String },

    approvedAt: Date,
    approvedBy: { name: String, id: String },
    rejectionReason: String,
    rejectedAt: Date,

    disbursedAt: Date,
    disbursedBy: { name: String, id: String },
    disbursementMethod: {
      type: String,
      enum: ["bank", "mpesa", "cash", "cheque"],
    },
    disbursementRef: String,

    // Accounting
    disbursementJournalId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
    },
    journalEntryIds: [{ type: Schema.Types.ObjectId, ref: "JournalEntry" }],

    // GL mapping (optional override — falls back to PayrollConfig.glMapping)
    glMapping: {
      staffLoansReceivable: { type: Schema.Types.ObjectId, ref: "Account" },
      bankAccount: { type: Schema.Types.ObjectId, ref: "Account" },
    },

    purpose: String,
    notes: { type: String, maxlength: 500 },
    currency: { type: String, default: "KES" },

    createdBy: {
      name: { type: String, required: true },
      id: { type: String, required: true },
    },
    lastModifiedBy: { name: String, id: String },
  },
  { timestamps: true }
);

// ============================================
// INDEXES
// ============================================
loanSchema.index({ companyId: 1, loanNumber: 1 }, { unique: true });
loanSchema.index({ companyId: 1, partyId: 1, status: 1 });
loanSchema.index({ companyId: 1, status: 1 });

// ============================================
// STATICS
// ============================================

/**
 * Generate loan number using ErpCounter.
 * Format: LN-{COMPANY_CODE}-{NNNN} or LN-{NNNN} if no company code.
 * Company code is fetched from Company.code or derived from name.
 */
loanSchema.statics.generateLoanNumber = async function (companyId, session) {
  const Company = mongoose.model("Company");

  let companyCode = null;
  if (companyId) {
    const company = await Company.findById(companyId).select("code name").lean();
    if (company) {
      companyCode = company.code || deriveCode(company.name);
    }
  }

  const counterName = companyCode
    ? `loan-${companyCode.toLowerCase()}`
    : "loan";

  const seq = await ErpCounter.getNextSequence(counterName, companyId, session);
  const prefix = companyCode ? `LN-${companyCode}` : "LN";
  return `${prefix}-${String(seq).padStart(4, "0")}`;
};

/** Derive a short company code from its name */
function deriveCode(name) {
  if (!name) return null;
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return words.slice(0, 4).map((w) => w[0]).join("").toUpperCase();
  }
  return name.slice(0, 3).toUpperCase();
}

/**
 * Get active loans for an employee
 */
loanSchema.statics.getActiveLoansForEmployee = function (companyId, partyId) {
  return this.find({
    companyId,
    partyId,
    status: { $in: ["disbursed", "active"] },
  })
    .sort({ startYear: 1, startMonth: 1 })
    .lean();
};

/**
 * Get pending installments for a payroll period
 */
loanSchema.statics.getPendingInstallments = function (companyId, month, year) {
  return this.find({
    companyId,
    status: { $in: ["disbursed", "active"] },
    installments: {
      $elemMatch: { month, year, status: "pending" },
    },
  }).lean();
};

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Generate installment schedule based on loan terms.
 * Supports: no interest, flat interest, reducing balance (EMI).
 */
loanSchema.methods.generateSchedule = function () {
  this.installments = [];
  let month = this.startMonth;
  let year = this.startYear;
  let remainingPrincipal = this.principalAmount;

  if (this.interestType === "none" || this.interestRate === 0) {
    // Equal principal installments, no interest
    const monthlyPrincipal = Math.floor(this.principalAmount / this.tenure);
    const lastPayment =
      this.principalAmount - monthlyPrincipal * (this.tenure - 1);

    for (let i = 0; i < this.tenure; i++) {
      const principal = i === this.tenure - 1 ? lastPayment : monthlyPrincipal;
      this.installments.push({
        month,
        year,
        principal,
        interest: 0,
        total: principal,
        status: "pending",
      });
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
    this.monthlyInstallment = monthlyPrincipal;
  } else if (this.interestType === "flat") {
    // Flat interest: total interest = principal * rate * (tenure/12)
    const totalInterest =
      this.principalAmount * this.interestRate * (this.tenure / 12);
    const monthlyPrincipal = Math.floor(this.principalAmount / this.tenure);
    const monthlyInterest = Math.floor(totalInterest / this.tenure);
    const lastPrincipal =
      this.principalAmount - monthlyPrincipal * (this.tenure - 1);
    const lastInterest =
      Math.round(totalInterest) - monthlyInterest * (this.tenure - 1);

    for (let i = 0; i < this.tenure; i++) {
      const p = i === this.tenure - 1 ? lastPrincipal : monthlyPrincipal;
      const int = i === this.tenure - 1 ? lastInterest : monthlyInterest;
      this.installments.push({
        month,
        year,
        principal: p,
        interest: int,
        total: p + int,
        status: "pending",
      });
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
    this.monthlyInstallment = monthlyPrincipal + monthlyInterest;
  } else if (this.interestType === "reducing_balance") {
    // EMI formula: EMI = P * r * (1+r)^n / ((1+r)^n - 1)
    const monthlyRate = this.interestRate / 12;
    const n = this.tenure;
    const emi = Math.round(
      (this.principalAmount *
        monthlyRate *
        Math.pow(1 + monthlyRate, n)) /
        (Math.pow(1 + monthlyRate, n) - 1)
    );

    for (let i = 0; i < n; i++) {
      const interest = Math.round(remainingPrincipal * monthlyRate);
      let principal = emi - interest;
      if (i === n - 1) {
        principal = remainingPrincipal;
      } // last installment clears balance
      const total = principal + interest;
      this.installments.push({
        month,
        year,
        principal,
        interest,
        total,
        status: "pending",
      });
      remainingPrincipal -= principal;
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
    this.monthlyInstallment = emi;
  }

  this.outstandingBalance = this.principalAmount;
  if (this.interestType === "flat") {
    this.outstandingBalance += this.installments.reduce(
      (s, i) => s + i.interest,
      0
    );
  }
};

/**
 * Record repayment for a given period.
 * Returns true if installment was found and marked, false otherwise.
 */
loanSchema.methods.recordRepayment = function (month, year, payrollRunId) {
  const installment = this.installments.find(
    (i) => i.month === month && i.year === year && i.status === "pending"
  );
  if (!installment) return false;

  installment.status = "deducted";
  installment.payrollRunId = payrollRunId;
  installment.paidAt = new Date();

  this.totalRepaid += installment.principal;
  this.totalInterestPaid += installment.interest;
  this.outstandingBalance -= installment.total;

  // Check if fully repaid
  const hasPending = this.installments.some((i) => i.status === "pending");
  if (!hasPending || this.outstandingBalance <= 0) {
    this.status = "fully_repaid";
    this.outstandingBalance = 0;
  }

  return true;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Loan = models?.Loan;

if (!Loan) {
  Loan = mongoose.model("Loan", loanSchema);
}

export default Loan;
export { Loan };

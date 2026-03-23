import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// SALARY HISTORY SCHEMA
// ============================================
// Records every compensation change per employee.
// Written automatically by updateCompensation action.
//
// Used for:
//   - Audit trail (who changed what and when)
//   - P9A annual PAYE certificate (taxable income each month of the year)
//   - Salary variance reports
//
// Design: separate collection (NOT embedded in EmployeeProfile)
// Reason: unbounded — one record per salary change, could be many over years
// ============================================

const salaryHistorySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    // Employee references
    profileId: {
      type: Schema.Types.ObjectId,
      ref: "EmployeeProfile",
      required: true,
      index: true,
    },
    partyId: {
      type: Schema.Types.ObjectId,
      ref: "Party",
      required: true,
      index: true,
    },

    // Snapshot at time of record (avoids $lookup)
    employeeName: String,
    employeeNumber: String,
    department: String,

    // Previous compensation values
    previous: {
      basicSalary: { type: Number, default: 0 },
      housingAllowance: { type: Number, default: 0 },
      transportAllowance: { type: Number, default: 0 },
      medicalAllowance: { type: Number, default: 0 },
      otherAllowance: { type: Number, default: 0 },
      grossSalary: { type: Number, default: 0 },   // sum of all above
    },

    // New compensation values
    updated: {
      basicSalary: { type: Number, default: 0 },
      housingAllowance: { type: Number, default: 0 },
      transportAllowance: { type: Number, default: 0 },
      medicalAllowance: { type: Number, default: 0 },
      otherAllowance: { type: Number, default: 0 },
      grossSalary: { type: Number, default: 0 },
    },

    // The delta (for quick reporting)
    basicSalaryChange: { type: Number, default: 0 },   // updated.basic - previous.basic
    grossSalaryChange: { type: Number, default: 0 },

    effectiveDate: {
      type: Date,
      default: Date.now,
      index: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    changedBy: { name: String, id: String },
  },
  { timestamps: true }
);

// Compound index for P9A: all salary changes for an employee sorted by date
salaryHistorySchema.index({ profileId: 1, effectiveDate: -1 });
salaryHistorySchema.index({ companyId: 1, effectiveDate: -1 });

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let SalaryHistory = models?.SalaryHistory;
if (!SalaryHistory) {
  SalaryHistory = mongoose.model("SalaryHistory", salaryHistorySchema);
}

export default SalaryHistory;
export { SalaryHistory };

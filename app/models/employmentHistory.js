import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// EMPLOYMENT HISTORY SCHEMA
// ============================================
// Logs every employment event: hire, promotion, department transfer,
// designation change, grade change, status change, termination, confirmation.
//
// Used for:
//   - Audit trail (who changed what and when)
//   - Contract expiry tracking
//   - Career progression reports
//   - P9A (employment period within the year)
//
// Design: separate collection (NOT embedded in EmployeeProfile)
// Reason: unbounded — could be many events over an employee's tenure
// ============================================

const EVENT_TYPES = [
  "hire",
  "probation_confirmation",
  "promotion",
  "department_change",
  "designation_change",
  "grade_change",
  "employment_type_change",
  "status_change",
  "termination",
  "contract_renewal",
  "other",
];

const employmentHistorySchema = new Schema(
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
    },

    // Snapshot at time of record
    employeeName: String,
    employeeNumber: String,

    eventType: {
      type: String,
      required: true,
      enum: EVENT_TYPES,
    },

    // Flexible before/after for any field change
    field: String,          // e.g. "department", "designation", "status", "employmentType"
    previousValue: String,  // stringified for generic storage
    newValue: String,

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

// All history for one employee, newest first
employmentHistorySchema.index({ profileId: 1, effectiveDate: -1 });
employmentHistorySchema.index({ companyId: 1, effectiveDate: -1 });

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let EmploymentHistory = models?.EmploymentHistory;
if (!EmploymentHistory) {
  EmploymentHistory = mongoose.model("EmploymentHistory", employmentHistorySchema);
}

export default EmploymentHistory;
export { EmploymentHistory };

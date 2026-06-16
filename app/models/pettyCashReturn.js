import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// PETTY CASH RETURN — the period statement (the "returns form")
// ============================================
// The header the custodian fills and submits to the MD: which float (petty
// cash account), the period, the opening balance brought forward, and the
// sign-off workflow. The DR column from the paper form lives here — the
// opening float and any top-ups are debits to the tin and belong on the
// header, not repeated on every row (per the CEO's note).
//
// The actual lines are PettyCashEntry rows referencing this return, so the
// petty cash account detail page can show them as a DR/CR ledger.
//
// Lifecycle: draft (custodian records) → submitted (returned to MD) →
// approved (MD signs) | rejected (back to the custodian).
const PETTY_CASH_RETURN_STATUSES = ["draft", "submitted", "approved", "rejected"];

const signOffSchema = new Schema(
  { name: { type: String }, id: { type: String }, at: { type: Date } },
  { _id: false },
);

const pettyCashReturnSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    // Auto-generated, e.g. PCRF-0001 (company can brand the prefix later).
    documentNumber: { type: String, required: true, trim: true },

    // The petty cash float (a cash/bank Account). Supports several tins later.
    floatAccountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },

    custodian: {
      userId: { type: Schema.Types.ObjectId, ref: "User" },
      partyId: { type: Schema.Types.ObjectId, ref: "Party" },
      name: { type: String, trim: true },
    },

    period: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
    },

    // Float brought forward (the header DR — opening cash in the tin).
    openingBalance: { type: Number, default: 0, min: 0 },

    // Computed on save from the entries (debits = top-ups, credits = spend).
    totals: {
      debits: { type: Number, default: 0 }, // float top-ups during the period
      credits: { type: Number, default: 0 }, // total spent
      closing: { type: Number, default: 0 }, // opening + debits − credits
    },

    status: {
      type: String,
      enum: PETTY_CASH_RETURN_STATUSES,
      default: "draft",
      index: true,
    },

    // Three sign-offs mirroring the paper form.
    preparedBy: signOffSchema, // custodian (on submit)
    reviewedBy: signOffSchema, // finance (optional)
    approvedBy: signOffSchema, // MD (on approve)
    rejectionReason: { type: String, trim: true, default: "" },

    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

pettyCashReturnSchema.index(
  { companyId: 1, documentNumber: 1 },
  { unique: true },
);
pettyCashReturnSchema.index({ companyId: 1, floatAccountId: 1, status: 1 });
pettyCashReturnSchema.index({ companyId: 1, "period.from": -1 });

const models = mongoose.models;
let PettyCashReturn = models?.PettyCashReturn;
if (!PettyCashReturn) {
  PettyCashReturn = mongoose.model("PettyCashReturn", pettyCashReturnSchema);
}

export default PettyCashReturn;
export { PettyCashReturn, PETTY_CASH_RETURN_STATUSES };

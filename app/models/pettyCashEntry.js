import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// PETTY CASH ENTRY — a single ledger line
// ============================================
// One row of the petty cash account: a debit (float received / top-up into the
// tin) or a credit (money spent). Stored as its own document — not embedded in
// the return — so the petty cash account detail page can render them as a
// DR/CR/Project-or-Purpose ledger and so a row can carry project cost.
//
// RULE (per the CEO): a SPEND (credit) must be tied to a project OR carry a
// proper description/purpose — it can never be blank. Enforced below.
const pettyCashEntrySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    // The float (petty cash account) and the period return this row belongs to.
    floatAccountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    returnId: {
      type: Schema.Types.ObjectId,
      ref: "PettyCashReturn",
      required: true,
      index: true,
    },

    date: { type: Date, required: true, default: Date.now },

    // Who the cash went to / came from (the NAMES column). Party optional —
    // a casual/contractor can be named without a Party record.
    payee: {
      partyId: { type: Schema.Types.ObjectId, ref: "Party" },
      name: { type: String, trim: true, required: true },
    },

    // What it was for (the DESCRIPTION column).
    description: { type: String, trim: true, required: true, maxlength: 300 },

    // Allocation (the PROJECT / PURPOSE column): a project when applicable,
    // otherwise a clear purpose/category. One of these must be present on a
    // spend (see validation).
    allocation: {
      projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
      costCodeId: {
        type: Schema.Types.ObjectId,
        ref: "ProjectCostCode",
        default: null,
      },
      purpose: { type: String, trim: true, default: "", maxlength: 200 },
    },

    // Optional COA expense account (the category a SPEND posts to — debit side
    // of DR Expense / CR Petty Cash). Falls back to a default petty-cash
    // expense account at posting time if unset.
    expenseAccountId: { type: Schema.Types.ObjectId, ref: "Account", default: null },

    // For a FLOAT-IN (debit): the bank the cash came from — the credit side of
    // DR Petty Cash / CR Bank. Required to post the funding transfer.
    sourceAccountId: { type: Schema.Types.ObjectId, ref: "Account", default: null },

    // The posted Journal Entry this row produced (funding transfer, or the
    // batched spend posting on approval). Links the ledger row to the GL.
    journalEntryId: { type: Schema.Types.ObjectId, ref: "JournalEntry", default: null },

    // debit = cash INTO the tin (float / top-up); credit = spend OUT.
    direction: {
      type: String,
      enum: ["debit", "credit"],
      required: true,
      default: "credit",
    },

    amount: { type: Number, required: true, min: [0.01, "Amount must be positive"] },

    // Becomes true when the return is approved by the MD. Only posted spends
    // are real cost — that's the flag project-cost aggregation filters on.
    posted: { type: Boolean, default: false },

    createdBy: { name: { type: String }, id: { type: String } },
  },
  { timestamps: true },
);

// A spend must be tied to a project OR a proper purpose — never blank.
pettyCashEntrySchema.pre("validate", function () {
  if (this.direction === "credit") {
    const hasProject = !!this.allocation?.projectId;
    const hasPurpose = !!(this.allocation?.purpose || "").trim();
    if (!hasProject && !hasPurpose) {
      this.invalidate(
        "allocation.purpose",
        "A petty cash expense must be tied to a project or have a clear purpose.",
      );
    }
  }
});

// Ledger of a float (account detail page) + roster of a return.
pettyCashEntrySchema.index({ companyId: 1, floatAccountId: 1, date: 1 });
pettyCashEntrySchema.index({ companyId: 1, returnId: 1 });
// Project-cost aggregation: posted spends for a project.
pettyCashEntrySchema.index({ companyId: 1, "allocation.projectId": 1, posted: 1 });

const models = mongoose.models;
let PettyCashEntry = models?.PettyCashEntry;
if (!PettyCashEntry) {
  PettyCashEntry = mongoose.model("PettyCashEntry", pettyCashEntrySchema);
}

export default PettyCashEntry;
export { PettyCashEntry };

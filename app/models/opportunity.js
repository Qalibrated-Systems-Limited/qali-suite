import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// OPPORTUNITY (DEAL) SCHEMA
// ============================================
// A qualified, trackable potential sale with a value, a stage and an
// owner — the unit of the sales pipeline. One Party (account) can have
// several open opportunities at once; each wins or loses on its own.
//
// Stage path:
//   qualification → needs_analysis → proposal → negotiation
//                 → closed_won  (hands off to Quote/Invoice spine)
//                 → closed_lost (records lostReason for win/loss analysis)
//
// `stageHistory` timestamps every transition so we can measure sales
// VELOCITY (how long deals sit in each stage) — the most actionable
// pipeline metric. `probability` defaults from the stage but can be
// overridden per deal; multiply amount × probability for a weighted
// forecast.

export const OPPORTUNITY_STAGES = [
  "qualification",
  "needs_analysis",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
];

// Default win-probability per stage (%). Pre-save seeds this when the
// caller hasn't set an explicit probability.
export const STAGE_PROBABILITY = {
  qualification: 10,
  needs_analysis: 25,
  proposal: 50,
  negotiation: 75,
  closed_won: 100,
  closed_lost: 0,
};

export const LOST_REASONS = [
  "price",
  "competitor",
  "timing",
  "no_budget",
  "no_decision",
  "other",
];

const opportunitySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    opportunityNumber: { type: String, required: true, index: true },

    name: { type: String, required: [true, "Opportunity name is required"], trim: true },

    // The customer this deal is for — a real Party. Snapshot the name so
    // pipeline lists render without a join.
    account: {
      partyId: {
        type: Schema.Types.ObjectId,
        ref: "Party",
        required: true,
        index: true,
      },
      name: String,
    },

    // Optional point person on the deal (snapshot; Contact model is a
    // later phase).
    primaryContact: {
      name: String,
      email: String,
      phone: String,
    },

    owner: {
      id: { type: String, index: true },
      name: String,
      role: String,
    },

    stage: {
      type: String,
      enum: OPPORTUNITY_STAGES,
      default: "qualification",
      required: true,
      index: true,
    },

    amount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "KES", uppercase: true },
    probability: { type: Number, min: 0, max: 100 },
    expectedCloseDate: Date,
    source: String,

    // Provenance — set when this opportunity was spawned by lead conversion.
    leadRef: {
      leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
      leadNumber: String,
    },

    // Set on closed_lost.
    lostReason: { type: String, enum: LOST_REASONS },
    lostNote: String,

    // Set on closed_won — the hand-off references into the transactional spine.
    wonDetails: {
      quoteId: { type: Schema.Types.ObjectId, ref: "Quote" },
      invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
      wonAt: Date,
    },

    // Every stage transition, for velocity analysis.
    stageHistory: [
      {
        stage: { type: String, enum: OPPORTUNITY_STAGES },
        at: { type: Date, default: Date.now },
        by: { id: String, name: String },
      },
    ],

    createdBy: { name: String, id: String },
    lastModifiedBy: { name: String, id: String },
  },
  { timestamps: true },
);

// Pipeline queries: board by stage, forecast by close date, "my deals".
opportunitySchema.index({ companyId: 1, stage: 1, expectedCloseDate: 1 });
opportunitySchema.index({ companyId: 1, "owner.id": 1, stage: 1 });
opportunitySchema.index({ companyId: 1, "account.partyId": 1 });
opportunitySchema.index({ companyId: 1, opportunityNumber: 1 }, { unique: true });

opportunitySchema.virtual("isOpen").get(function () {
  return this.stage !== "closed_won" && this.stage !== "closed_lost";
});
opportunitySchema.virtual("isWon").get(function () {
  return this.stage === "closed_won";
});
// Weighted value for forecasting (amount × probability).
opportunitySchema.virtual("weightedAmount").get(function () {
  const p = typeof this.probability === "number"
    ? this.probability
    : STAGE_PROBABILITY[this.stage] ?? 0;
  return Math.round((Number(this.amount) || 0) * (p / 100) * 100) / 100;
});

// Seed probability from the stage when not explicitly provided, and append
// a stageHistory entry whenever the stage changes (including on create).
// No-`next` (promise-style) form: Mongoose 9 invokes save middleware without
// a next callback when documents are persisted via Model.create([...]),
// which is how opportunities are created here. The body is fully synchronous,
// so returning undefined lets the save proceed.
opportunitySchema.pre("save", function () {
  if (this.probability === undefined || this.probability === null) {
    this.probability = STAGE_PROBABILITY[this.stage] ?? 0;
  }
  if (this.isNew || this.isModified("stage")) {
    this.stageHistory = this.stageHistory || [];
    this.stageHistory.push({
      stage: this.stage,
      at: new Date(),
      by: this.lastModifiedBy || this.createdBy || undefined,
    });
  }
});

const Opportunity =
  mongoose.models.Opportunity ||
  mongoose.model("Opportunity", opportunitySchema);

export default Opportunity;

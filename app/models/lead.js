import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// LEAD SCHEMA
// ============================================
// A lead is an UNQUALIFIED prospect — a name with a flicker of interest
// (website form, walk-in, referral, trade show) that we have not yet
// vetted. Deliberately kept OUT of the financial spine: a lead has no
// Party record, no credit terms, no balance. Polluting Party with
// tire-kickers would corrupt AR aging and customer counts.
//
// Lifecycle:
//   new → contacted → qualified → converted   (graduates into a Party + Opportunity)
//                   → unqualified              (dead — never becomes a customer)
//
// On conversion (see convertLead in lead-actions) the lead atomically
// spawns a Party (customer) and an Opportunity, and is stamped converted.

export const LEAD_SOURCES = [
  "website",
  "referral",
  "walk_in",
  "campaign",
  "cold_call",
  "trade_show",
  "social",
  "other",
];

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "unqualified",
  "converted",
];

export const LEAD_RATINGS = ["hot", "warm", "cold"];

const leadSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Human-friendly ID for UI/display (e.g. "LEAD-0042")
    leadNumber: { type: String, required: true, index: true },

    // The person. `company` is FREE TEXT — it is NOT a Party yet.
    name: { type: String, required: [true, "Lead name is required"], trim: true },
    company: { type: String, trim: true },
    title: { type: String, trim: true }, // job title
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },

    source: { type: String, enum: LEAD_SOURCES, default: "other", index: true },
    rating: { type: String, enum: LEAD_RATINGS },

    status: {
      type: String,
      enum: LEAD_STATUSES,
      default: "new",
      required: true,
      index: true,
    },

    // Rough size of the opportunity if it pans out — used for funnel value.
    estimatedValue: { type: Number, default: 0, min: 0 },

    // Sales user who owns the follow-up. Snapshot id/name like the rest of
    // the codebase (see ApprovalRequest.submittedBy) so "my leads" queries
    // never need a join.
    owner: {
      id: { type: String, index: true },
      name: String,
      role: String,
    },

    notes: String,

    // When status → unqualified, why we walked (analytics).
    lostReason: String,

    // Conversion result — set once, when the lead graduates.
    convertedTo: {
      partyId: { type: Schema.Types.ObjectId, ref: "Party" },
      opportunityId: { type: Schema.Types.ObjectId, ref: "Opportunity" },
    },
    convertedAt: Date,

    createdBy: { name: String, id: String },
    lastModifiedBy: { name: String, id: String },
  },
  { timestamps: true },
);

// Queue/list queries: "open leads by recency", "my leads", uniqueness.
leadSchema.index({ companyId: 1, status: 1, createdAt: -1 });
leadSchema.index({ companyId: 1, "owner.id": 1, status: 1 });
leadSchema.index({ companyId: 1, leadNumber: 1 }, { unique: true });

leadSchema.virtual("isOpen").get(function () {
  return this.status !== "converted" && this.status !== "unqualified";
});

const Lead = mongoose.models.Lead || mongoose.model("Lead", leadSchema);

export default Lead;

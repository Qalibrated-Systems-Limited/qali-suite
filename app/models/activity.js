import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// ACTIVITY SCHEMA
// ============================================
// The relationship timeline. One append-only record per interaction —
// call, email, meeting, note, or a system-generated event (stage change,
// conversion). Polymorphic `relatedTo` so a single collection logs against
// any CRM entity, and one query renders the history panel on a lead,
// opportunity, or customer.

export const ACTIVITY_TYPES = [
  "note",
  "call",
  "email",
  "meeting",
  "whatsapp",
  "sms",
  "stage_change",
  "conversion",
  "system",
];

export const ACTIVITY_TARGETS = [
  "Lead",
  "Opportunity",
  "Party",
  "Contact",
  "Invoice",
  "Quote",
];

const activitySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    type: { type: String, enum: ACTIVITY_TYPES, required: true },

    // What this activity is attached to.
    relatedTo: {
      kind: { type: String, enum: ACTIVITY_TARGETS, required: true },
      id: { type: Schema.Types.ObjectId, required: true },
    },

    subject: String,
    body: String,

    // Communication direction (calls/emails); "none" for notes/system.
    direction: {
      type: String,
      enum: ["inbound", "outbound", "none"],
      default: "none",
    },

    // When the interaction happened (may differ from createdAt for
    // back-dated logging).
    occurredAt: { type: Date, default: Date.now, index: true },

    by: { id: String, name: String, role: String },
  },
  { timestamps: true },
);

// The timeline query: all activity for one entity, newest first.
activitySchema.index({
  companyId: 1,
  "relatedTo.kind": 1,
  "relatedTo.id": 1,
  occurredAt: -1,
});
// Per-user activity feed / leaderboard.
activitySchema.index({ companyId: 1, "by.id": 1, occurredAt: -1 });

const Activity =
  mongoose.models.Activity || mongoose.model("Activity", activitySchema);

export default Activity;

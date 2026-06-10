import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// APPROVAL REQUEST SCHEMA
// ============================================
// Generic threshold-based approval engine. One ApprovalRequest per pending
// transition (a price drop below floor, a write-off above threshold, etc.).
//
// Lifecycle:
//   submitted → approved   (terminal — apply the change)
//             → rejected   (terminal — discard)
//             → cancelled  (submitter aborts before decision)
//
// Each request carries a payload: the proposed new state, and a reference
// to the source document. When approved, the action service reads the
// payload and applies it (e.g., updates Product.pricing.sellingPrice).
//
// Industry standard: matrix-based approver list (which roles can approve),
// audit log of every action, no in-place edits — append-only.

const APPROVAL_TYPES = [
  "price_change", // Product.pricing.* edit (below floor / below cost)
  "stock_writeoff", // Stock adjustment that decreases quantity above threshold
  "stock_adjustment", // Generic stock count correction (large)
  "bill_payment", // Large bill payment release
  "credit_note", // Customer credit issuance
  "discount", // Sale discount above cap
];

// "applying" is an intermediate status held by a single concurrent
// approver to prevent double-application. The approve flow uses an
// atomic findOneAndUpdate from "submitted" → "applying" as a lease;
// no other caller can also flip "submitted" → "applying" once one has.
// The lease is finalized to "approved" after the payload applier
// succeeds, or rolled back to "submitted" if it fails.
const APPROVAL_STATUSES = [
  "submitted",
  "applying",
  "approved",
  "rejected",
  "cancelled",
];

const approvalRequestSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    // Type classifies what this request is about — drives both the UI
    // copy and the application logic on approval.
    type: {
      type: String,
      enum: APPROVAL_TYPES,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: APPROVAL_STATUSES,
      default: "submitted",
      required: true,
      index: true,
    },

    // Auto-generated short ID for UI display (e.g. "APR-0042")
    requestNumber: { type: String, required: true, index: true },

    // Reference to the source document being affected. We store both
    // the kind (model name) and the id so a single page can render any
    // request type with a deep-link.
    targetRef: {
      kind: {
        type: String,
        enum: [
          "Product",
          "InventoryAdjustment",
          "StockAdjustment", // legacy alias kept for backward compat
          "Bill",
          "Invoice",
          "CreditNote",
          "Payment", // bill_payment approvals reference the draft Payment
        ],
        required: true,
      },
      id: { type: Schema.Types.ObjectId, required: true },
      // Snapshot fields for display — survives renames / deletions on the
      // referenced doc. Mirror the bill-line snapshot pattern.
      label: String, // e.g. "TYRE-185-65-R15 — Heavy duty tyre"
    },

    // The proposed new state. Shape is type-specific. The action service
    // reads this on approval to apply the change.
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // Why this request was raised (the engine populated this — e.g.
    // "Selling price below cost" / "Margin would drop below 8% floor")
    reason: { type: String, default: "" },

    // What the requester typed (their justification for the change).
    requesterNote: { type: String, default: "" },

    // Threshold values captured at submission for post-hoc audit clarity.
    // For pricing: floor at the time, current cost, current selling.
    // For write-off: amount, threshold tripped.
    context: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // Who can approve — roles, not specific users. Approver matrix is
    // populated from the type at submission. e.g. "below cost" needs
    // ["SuperAdmin", "Admin","CFO"] only; smaller variances need broader sets.
    requiredApproverRoles: [{ type: String }],

    // Who raised it
    submittedBy: {
      id: { type: String, required: true },
      name: { type: String, required: true },
      role: String,
      submittedAt: { type: Date, default: Date.now, index: true },
    },

    // Decision (if any)
    decision: {
      action: { type: String, enum: ["approved", "rejected", "cancelled"] },
      by: {
        id: String,
        name: String,
        role: String,
      },
      at: Date,
      note: String,
    },

    // After approval, the action service writes the journal/state change
    // here for audit. Optional — not all types produce a JE.
    appliedAt: Date,
    appliedRef: {
      kind: String,
      id: { type: Schema.Types.ObjectId },
    },
  },
  { timestamps: true },
);

// Tenant-aware indexes that match the queue queries:
//   "what's pending for me to approve"
//   "what did I submit"
approvalRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });
approvalRequestSchema.index({ companyId: 1, type: 1, status: 1 });
approvalRequestSchema.index({ companyId: 1, "submittedBy.id": 1, status: 1 });
approvalRequestSchema.index(
  { companyId: 1, requestNumber: 1 },
  { unique: true },
);
// Reaper index: only "applying" leases are indexed (partial), keyed by
// updatedAt so the stale-lease sweeper (GET /api/cron/reap-approvals) can
// find docs stuck mid-apply after a crash without scanning the collection.
// "applying" is a tiny, short-lived set so the write cost is negligible.
approvalRequestSchema.index(
  { updatedAt: 1 },
  { partialFilterExpression: { status: "applying" } },
);

// ============================================
// CONFIG: who can approve what
// ============================================
// One source of truth — used by both the model (to populate
// requiredApproverRoles) and the queue query (to filter for "my queue").
export const APPROVER_MATRIX = {
  price_change: ["SuperAdmin", "Admin", "CFO", "Finance Manager"],
  stock_writeoff: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Manager"],
  stock_adjustment: ["SuperAdmin", "Admin", "Manager", "Store Manager"],
  bill_payment: ["SuperAdmin", "Admin", "CFO", "Finance Manager"],
  credit_note: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Sales Manager"],
  discount: ["SuperAdmin", "Admin", "CFO", "Finance Manager", "Sales Manager"],
};

approvalRequestSchema.statics.canApprove = function (role, type) {
  if (!role || !type) return false;
  if (role === "SuperAdmin") return true;
  return (APPROVER_MATRIX[type] || []).includes(role);
};

const ApprovalRequest =
  mongoose.models.ApprovalRequest ||
  mongoose.model("ApprovalRequest", approvalRequestSchema);

export { APPROVAL_TYPES, APPROVAL_STATUSES };
export default ApprovalRequest;

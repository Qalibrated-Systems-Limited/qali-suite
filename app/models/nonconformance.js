import mongoose from "mongoose";

// ============================================
// NONCONFORMANCE (NCR) — SOP §10.6
// ============================================
// First-class document for any item or condition that doesn't conform to
// specified requirements. Sources include:
//   - GRN discrepancy (quantity short / over / damaged on receipt)
//   - Stock count variance (count != system; SOP §10.2.4)
//   - Tool returned damaged (SOP §10.4.4)
//   - Stock deterioration discovered in storage
//   - General "manual" (operator-raised)
//
// Lifecycle:
//   open                  — created; awaiting disposition decision
//   disposition_proposed  — someone proposed return/repair/downgrade/scrap
//   authorized            — MD (or delegated authority) signed off
//   closed                — disposition executed, NCR resolved
//   cancelled             — duplicate / raised in error
//
// SOP §10.6 requirement: "No nonconforming item shall be released for
// use, issued to a project or client, or incorporated into saleable
// stock until its disposition has been formally determined and
// authorised."
// ============================================

const { Schema, model, models } = mongoose;

const CATEGORIES = [
  "received_qty_variance",   // Quantity differs from PL/PO/bill
  "received_damaged",        // Visible damage at receipt
  "stock_deterioration",     // Discovered damage/expiry in storage
  "tool_damage",             // Tool returned damaged (SOP §10.4.4)
  "stock_count_variance",    // Cycle/quarterly count variance
  "other",                   // Free-text manual NCR
];

const DISPOSITIONS = [
  "pending",              // Not decided yet
  "return_to_supplier",   // Supplier-attributable nonconformity
  "repair",               // Item is repairable
  "downgrade",            // Suitable for less critical use
  "scrap",                // Write-off (requires MD authorization)
  "accept_as_is",         // Use anyway (rare; needs MD authorization)
];

const STATUSES = [
  "open",
  "disposition_proposed",
  "authorized",
  "closed",
  "cancelled",
];

const nonconformanceLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    sku: String,
    description: String,
    expectedQty: { type: Number, default: 0 },
    actualQty: { type: Number, default: 0 },
    variance: { type: Number, default: 0 },
    unit: String,
    severity: {
      type: String,
      enum: ["minor", "major", "critical"],
      default: "minor",
    },
    notes: String,
  },
  { _id: true },
);

const nonconformanceSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    ncrNumber: { type: String, required: true, trim: true },

    category: {
      type: String,
      enum: CATEGORIES,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: STATUSES,
      default: "open",
      index: true,
    },

    // ── Source linkage ────────────────────────────────────────────────
    // What did this NCR come from? Used to drive automatic creation
    // from GRN, stock count, tool return etc.
    source: {
      type: {
        type: String,
        enum: [
          "goods_receipt",
          "stock_count",
          "tool_return",
          "stock_deterioration",
          "manual",
        ],
        required: true,
      },
      // Polymorphic ref — populated based on source.type. The model
      // string we expect to resolve is implied by the type field.
      grnId: { type: Schema.Types.ObjectId, ref: "GoodsReceipt", index: true },
      stockCountId: { type: Schema.Types.ObjectId },
      toolReturnId: { type: Schema.Types.ObjectId },
      reference: String, // GRN number / count number / tool ID, snapshot
    },

    // Affected supplier (snapshot for audit) — useful for return-to-supplier
    // disposition and for SOP §10.6's "report to supplier" step.
    supplier: {
      partyId: { type: Schema.Types.ObjectId, ref: "Party" },
      name: String,
    },

    // ── What's wrong ──────────────────────────────────────────────────
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    lines: [nonconformanceLineSchema],

    // Total financial impact if known (for management review)
    estimatedImpact: { type: Number, default: 0 },

    // Photos / attachments
    photoUrls: [{ type: String, trim: true }],

    // ── Disposition (SOP §10.6) ───────────────────────────────────────
    disposition: {
      type: { type: String, enum: DISPOSITIONS, default: "pending" },
      reason: String,
      proposedBy: { id: String, name: String, at: Date },
      // MD (or delegated authority) authorization. SOP §10.6 says
      // "The Managing Director shall determine the appropriate course
      // of action".
      authorizedBy: { id: String, name: String, at: Date, notes: String },
      executedAt: Date,
      executedBy: { id: String, name: String },
      executionNotes: String,
    },

    // ── CAR (Corrective Action Report) ────────────────────────────────
    // SOP §10.6: "Recurring or systemic nonconformities shall be
    // escalated via a formal Corrective Action Report (CAR)." For v1
    // we just flag and free-text — separate CAR entity is future work.
    requiresCAR: { type: Boolean, default: false },
    carRaisedAt: Date,
    carNotes: String,

    // ── Audit ─────────────────────────────────────────────────────────
    createdBy: { id: String, name: String },
    lastModifiedBy: { id: String, name: String },
  },
  { timestamps: true, collection: "nonconformances" },
);

nonconformanceSchema.index({ companyId: 1, ncrNumber: 1 }, { unique: true });
nonconformanceSchema.index({ companyId: 1, status: 1, createdAt: -1 });
nonconformanceSchema.index({ companyId: 1, category: 1 });

nonconformanceSchema.virtual("isResolved").get(function () {
  return ["closed", "cancelled"].includes(this.status);
});

nonconformanceSchema.statics.generateNCRNumber = async function (
  companyId,
  session = null,
) {
  const year = new Date().getFullYear();
  const prefix = `NCR-${year}-`;
  const opts = session ? { session } : {};
  const last = await this.findOne(
    { companyId, ncrNumber: { $regex: `^${prefix}` } },
    null,
    opts,
  )
    .sort({ ncrNumber: -1 })
    .lean();
  let next = 1;
  if (last?.ncrNumber) {
    const m = last.ncrNumber.match(/-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

const Nonconformance =
  models.Nonconformance || model("Nonconformance", nonconformanceSchema);
export default Nonconformance;

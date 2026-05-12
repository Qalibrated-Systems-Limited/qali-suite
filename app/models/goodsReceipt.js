import mongoose from "mongoose";

// ============================================
// GOODS RECEIPT NOTE (GRN)
// ============================================
// SOP §10.1 — every receipt of goods from a supplier is documented on a
// GRN. The Storeperson inspects, Sales + Finance accept (or reject), and
// only on acceptance is stock admitted to issuable inventory. Until then
// the items sit in the HOLD bucket (product.inventory.quantityOnHold).
//
// Status lifecycle:
//   draft               — created from bill / unscheduled, not yet submitted
//   pending_acceptance  — Storeperson submitted; awaiting Sales+Finance
//   accepted            — fully accepted (all lines)
//   partially_accepted  — some lines accepted, some rejected
//   rejected            — fully rejected; goods returned to supplier
//   voided              — created in error; no inventory effect
// ============================================

const { Schema, model, models } = mongoose;

// Per-line condition codes — match SOP §10.1.2 inspection criteria
const PACKAGING_CONDITIONS = ["good", "damaged", "moisture", "tampered"];
const PHYSICAL_CONDITIONS = ["good", "broken", "deformed", "defective"];

const grnLineSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    sku: String,
    description: { type: String, required: true },

    expectedQty: { type: Number, required: true, min: 0 },
    receivedQty: { type: Number, required: true, min: 0 },
    unit: { type: String, default: "pcs" },

    // Inspection (SOP §10.1.2 step 3)
    packagingCondition: {
      type: String,
      enum: PACKAGING_CONDITIONS,
      default: "good",
    },
    physicalCondition: {
      type: String,
      enum: PHYSICAL_CONDITIONS,
      default: "good",
    },
    inspectionNotes: { type: String, trim: true },
    photoUrls: [{ type: String, trim: true }],

    // Per-line decision — Sales+Finance can accept some lines, reject others
    lineStatus: {
      type: String,
      enum: ["pending", "accepted", "rejected", "hold"],
      default: "pending",
    },
    acceptedQty: { type: Number, default: 0, min: 0 }, // ≤ receivedQty
    rejectReason: String,

    // Storage assignment (SOP §10.1.2 step 7)
    storageLocation: { type: String, trim: true },

    // Atomic claim: filled when accepted-from-hold has been applied to
    // product inventory, prevents double-application on retry / replay.
    inventoryApplied: { type: Boolean, default: false },
  },
  { _id: true },
);

const goodsReceiptSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    grnNumber: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: [
        "draft",
        "pending_acceptance",
        "accepted",
        "partially_accepted",
        "rejected",
        "voided",
      ],
      default: "draft",
      index: true,
    },

    // ── Source of the receipt ─────────────────────────────────────────
    source: {
      type: {
        type: String,
        enum: ["bill", "purchase_order", "unscheduled"],
        default: "bill",
      },
      billId: { type: Schema.Types.ObjectId, ref: "Bill", index: true },
      purchaseOrderId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder" },
      proformaInvoiceNumber: String,
      packingListNumber: String,
    },

    supplier: {
      partyId: { type: Schema.Types.ObjectId, ref: "Party" },
      name: String,
    },

    // ── Receipt event ─────────────────────────────────────────────────
    receivedDate: { type: Date, default: Date.now },
    receivedBy: { id: String, name: String },

    lines: [grnLineSchema],

    // Summary flag set by the controller when any line has a discrepancy;
    // drives the SOP §10.1.3 "report to Sales+Finance with summary" step.
    hasDiscrepancy: { type: Boolean, default: false },
    discrepancyNotes: String,

    // ── Acceptance workflow (SOP §10.1.2 step 5) ──────────────────────
    // SOP requires written confirmation from BOTH Sales and Finance.
    // We model each as a separate sign-off so the approval is auditable.
    salesAccepted: {
      id: String,
      name: String,
      at: Date,
      notes: String,
    },
    financeAccepted: {
      id: String,
      name: String,
      at: Date,
      notes: String,
    },
    acceptedAt: Date,

    rejectedAt: Date,
    rejectedBy: { id: String, name: String },
    rejectReason: String,

    // ── Cross-references ──────────────────────────────────────────────
    // Filled when discrepancy reaches §10.6 NCR workflow (built later).
    ncrId: { type: Schema.Types.ObjectId, ref: "Nonconformance" },

    notes: { type: String, trim: true },

    createdBy: { id: String, name: String },
    lastModifiedBy: { id: String, name: String },
  },
  { timestamps: true, collection: "goodsreceipts" },
);

goodsReceiptSchema.index({ companyId: 1, grnNumber: 1 }, { unique: true });
goodsReceiptSchema.index({ companyId: 1, status: 1, receivedDate: -1 });
goodsReceiptSchema.index({ companyId: 1, "source.billId": 1 });

// Virtuals — lightweight computed flags for the UI
goodsReceiptSchema.virtual("isEditable").get(function () {
  return this.status === "draft";
});

goodsReceiptSchema.virtual("isAcceptable").get(function () {
  return this.status === "pending_acceptance";
});

goodsReceiptSchema.virtual("isFinalised").get(function () {
  return ["accepted", "rejected", "partially_accepted", "voided"].includes(
    this.status,
  );
});

// Sales + Finance both signed off?
goodsReceiptSchema.virtual("isFullyApproved").get(function () {
  return Boolean(this.salesAccepted?.at && this.financeAccepted?.at);
});

// Static — generate the next GRN number for a company.
// Format: GRN-YYYY-XXXX (sequential per year per company).
goodsReceiptSchema.statics.generateGRNNumber = async function (
  companyId,
  session = null,
) {
  const year = new Date().getFullYear();
  const prefix = `GRN-${year}-`;
  const opts = session ? { session } : {};
  const last = await this.findOne(
    { companyId, grnNumber: { $regex: `^${prefix}` } },
    null,
    opts,
  )
    .sort({ grnNumber: -1 })
    .lean();
  let next = 1;
  if (last?.grnNumber) {
    const m = last.grnNumber.match(/-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
};

const GoodsReceipt =
  models.GoodsReceipt || model("GoodsReceipt", goodsReceiptSchema);
export default GoodsReceipt;

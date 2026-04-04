import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// FARMER INTAKE ENTRY MODEL
// Records a single farmer delivery to the
// cooperative collection centre.
//
// Created by CoffeeCoopConnector on receipt
// of a "collection.intake_created" event from
// the intake station software.
//
// GL posted immediately on creation:
//   DR Inventory (coffee stock)
//   CR Farmer Payable (member account)
//
// Payment clearing (DR Farmer Payable / CR Cash
// or Bank) happens through a separate payment
// transaction when the farmer is paid.
// ============================================

export const COFFEE_TYPES = ["cherry", "parchment", "mbuni"];
export const COFFEE_TYPE_LABELS = {
  cherry:    "Cherry (Wet)",
  parchment: "Parchment (Dry)",
  mbuni:     "Mbuni (Dried Cherry)",
};

// Coffee grades — Kenya grading scale
export const COFFEE_GRADES = ["AA", "AB", "C", "PB", "E", "TT", "UG", "ungraded"];
export const COFFEE_GRADE_LABELS = {
  AA:       "AA (Premium)",
  AB:       "AB (Standard)",
  C:        "C (Commercial)",
  PB:       "PB (Peaberry)",
  E:        "E (Elephant Bean)",
  TT:       "TT (Light Beans)",
  UG:       "UG (Ungraded)",
  ungraded: "Ungraded",
};

export const PAYMENT_METHODS  = ["cash", "member_account", "mpesa", "bank_transfer"];
export const PAYMENT_STATUSES = ["pending", "paid", "partial"];
export const INTAKE_STATUSES  = ["received", "graded", "processed", "rejected"];

const farmerIntakeEntrySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    // Human-readable entry number — auto-generated
    entryNumber: {
      type: String,
      required: true,
    },

    // Reference from intake station software (idempotency key)
    externalRef: {
      type: String,
      default: null,
      index: true,
    },

    // Season this delivery belongs to
    seasonId: {
      type: Schema.Types.ObjectId,
      ref: "CoffeeSeason",
      required: true,
      index: true,
    },
    seasonName: { type: String, default: "" }, // snapshot

    // ── Farmer / Member ──────────────────────────────────
    farmerCode:  { type: String, required: true, index: true }, // member number
    farmerName:  { type: String, default: "" },
    farmerPhone: { type: String, default: "" },

    // ── Coffee Details ───────────────────────────────────
    coffeeType: {
      type: String,
      enum: COFFEE_TYPES,
      required: true,
    },
    grade: {
      type: String,
      enum: COFFEE_GRADES,
      required: true,
    },

    // ── Weight ───────────────────────────────────────────
    grossWeight:     { type: Number, required: true, min: 0 }, // kg, as weighed
    moisture:        { type: Number, default: 0, min: 0, max: 100 }, // % water content
    deductionWeight: { type: Number, default: 0, min: 0 }, // deduction applied (tare, moisture, etc.)
    netWeight:       { type: Number, required: true, min: 0 }, // grossWeight - deductionWeight

    // ── Pricing & Payment ────────────────────────────────
    unitPrice:   { type: Number, required: true, min: 0 }, // KES per kg net
    currency:    { type: String, default: "KES" },
    totalAmount: { type: Number, required: true, min: 0 }, // netWeight × unitPrice

    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: "member_account",
    },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: "pending",
      index: true,
    },
    amountPaid:  { type: Number, default: 0 },
    paymentRef:  { type: String, default: "" }, // mpesa code, etc.
    paidAt:      { type: Date, default: null },

    // ── ERP Links ────────────────────────────────────────
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    productSnapshot: {
      name: String,
      SKU:  String,
      unit: String,
    },
    stockMovementId: {
      type: Schema.Types.ObjectId,
      ref: "StockMovement",
      default: null,
    },
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },
    journalEntryNumber: { type: String, default: null },

    // ── Processing Status ────────────────────────────────
    status: {
      type: String,
      enum: INTAKE_STATUSES,
      default: "received",
      index: true,
    },
    warnings: [{ type: String }],

    // ── Staff ────────────────────────────────────────────
    collectedBy: {
      id:   { type: String },
      name: { type: String },
    },
    receivedAt: { type: Date, default: () => new Date() },
    notes:      { type: String, default: "" },
  },
  {
    timestamps: true,
    collection: "farmerIntakeEntries",
  }
);

// ── Indexes ────────────────────────────────────────────────
farmerIntakeEntrySchema.index({ companyId: 1, entryNumber: 1 }, { unique: true });
farmerIntakeEntrySchema.index({ companyId: 1, seasonId: 1, createdAt: -1 });
farmerIntakeEntrySchema.index({ companyId: 1, farmerCode: 1, seasonId: 1 });
farmerIntakeEntrySchema.index({ companyId: 1, paymentStatus: 1 });
farmerIntakeEntrySchema.index({ companyId: 1, externalRef: 1 });

const FarmerIntakeEntry =
  mongoose.models.FarmerIntakeEntry ||
  mongoose.model("FarmerIntakeEntry", farmerIntakeEntrySchema);

export default FarmerIntakeEntry;

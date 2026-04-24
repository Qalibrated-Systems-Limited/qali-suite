import mongoose from "mongoose";
import ErpCounter from "./erp-counter";

const Schema = mongoose.Schema;

// ============================================
// DEPRECIATION SCHEDULE SUB-SCHEMA
// ============================================
// One entry per month for the asset's useful life.
// Each entry carries the period-specific depreciation amount,
// running accumulated depreciation, book value after this posting,
// and the status/reference to the posted journal entry (when posted).
// ============================================
const depreciationScheduleSchema = new Schema(
  {
    period: { type: String, required: true }, // "2026-03"
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    depreciationAmount: { type: Number, required: true, min: 0 },
    accumulatedDepreciation: { type: Number, required: true, min: 0 },
    bookValue: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["pending", "posted", "skipped"],
      default: "pending",
    },
    journalEntryId: { type: Schema.Types.ObjectId, ref: "JournalEntry" },
    postedAt: Date,
  },
  { _id: false },
);

// ============================================
// ASSET SCHEMA
// ============================================
const assetSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    assetNumber: { type: String, required: true }, // Auto: AST-0001

    // Basic info
    name: { type: String, required: true, trim: true },
    description: String,
    category: {
      type: String,
      enum: [
        "vehicle",
        "equipment",
        "computer",
        "furniture",
        "building",
        "land",
        "machinery",
        "other",
      ],
      required: true,
      index: true,
    },

    // Identification
    serialNumber: String,
    model: String,
    manufacturer: String,
    registrationNumber: String, // For vehicles (e.g., KCB 123X)

    // Location & assignment
    location: String,
    department: String,
    assignedToPartyId: { type: Schema.Types.ObjectId, ref: "Party" }, // Employee using the asset
    assignedToName: String,

    // Financial — acquisition
    acquisitionDate: { type: Date, required: true },
    acquisitionCost: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "KES" },

    // Link to source document (bill or journal entry where asset was capitalized from)
    sourceType: {
      type: String,
      enum: ["bill", "journal", "manual"],
      default: "manual",
    },
    sourceId: { type: Schema.Types.ObjectId }, // bill or journal entry id
    sourceReference: String,

    // Depreciation setup
    depreciationMethod: {
      type: String,
      enum: ["straight_line", "reducing_balance", "none"], // "none" for land
      default: "straight_line",
      required: true,
    },
    usefulLifeMonths: {
      type: Number,
      min: 0,
      max: 1200,
      default: 60,
    }, // 60 months = 5 years
    salvageValue: { type: Number, default: 0, min: 0 }, // Residual value at end of life
    depreciationRate: { type: Number, default: 0, min: 0, max: 1 }, // For reducing balance (e.g., 0.25 = 25%)
    depreciationStartDate: { type: Date, required: true }, // When to start depreciating

    // Running totals
    accumulatedDepreciation: { type: Number, default: 0, min: 0 },
    bookValue: {
      type: Number,
      default: function () {
        return this.acquisitionCost;
      },
    },

    // Schedule
    depreciationSchedule: [depreciationScheduleSchema],

    // KRA / Tax
    // Class I: 37.5% (heavy machinery)
    // Class II: 30% (computers)
    // Class III: 25% (vehicles commercial)
    // Class IV: 12.5% (furniture, other)
    kraClass: {
      type: String,
      enum: ["class_I", "class_II", "class_III", "class_IV", "none"],
      default: "none",
    },

    // GL Mapping (falls back to company default if not set)
    glMapping: {
      assetAccount: { type: Schema.Types.ObjectId, ref: "Account" },
      accumulatedDepreciationAccount: {
        type: Schema.Types.ObjectId,
        ref: "Account",
      },
      depreciationExpenseAccount: {
        type: Schema.Types.ObjectId,
        ref: "Account",
      },
    },

    // Status lifecycle
    status: {
      type: String,
      enum: ["active", "disposed", "written_off", "in_maintenance", "idle"],
      default: "active",
      index: true,
    },

    // Disposal
    disposedAt: Date,
    disposedBy: { name: String, id: String },
    disposalMethod: {
      type: String,
      enum: ["sold", "scrapped", "donated", "lost", "stolen"],
    },
    disposalAmount: { type: Number, default: 0 },
    disposalJournalId: { type: Schema.Types.ObjectId, ref: "JournalEntry" },
    gainOrLoss: { type: Number, default: 0 }, // Positive = gain, negative = loss
    disposalNotes: String,

    // Attachments
    photoUrl: String,
    documents: [
      {
        name: String,
        url: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    // Insurance & compliance (for vehicles mainly)
    insurance: {
      provider: String,
      policyNumber: String,
      expiryDate: Date,
      premium: Number,
    },
    inspection: {
      lastDate: Date,
      nextDueDate: Date,
    },

    // Audit
    notes: String,
    journalEntryIds: [{ type: Schema.Types.ObjectId, ref: "JournalEntry" }],
    createdBy: {
      name: { type: String, required: true },
      id: { type: String, required: true },
    },
    lastModifiedBy: { name: String, id: String },
  },
  { timestamps: true },
);

// ============================================
// INDEXES
// ============================================
assetSchema.index({ companyId: 1, assetNumber: 1 }, { unique: true });
assetSchema.index({ companyId: 1, status: 1, category: 1 });
assetSchema.index(
  { companyId: 1, registrationNumber: 1 },
  { sparse: true },
);
assetSchema.index({
  companyId: 1,
  "depreciationSchedule.period": 1,
  "depreciationSchedule.status": 1,
});

// ============================================
// STATICS
// ============================================

/**
 * Generate asset number using ErpCounter.
 * Format: AST-0001
 */
assetSchema.statics.generateAssetNumber = async function (
  companyId,
  session,
) {
  const seq = await ErpCounter.getNextSequence("asset", companyId, session);
  return `AST-${String(seq).padStart(4, "0")}`;
};

/**
 * Get assets with depreciation pending for a given period.
 */
assetSchema.statics.getPendingDepreciation = function (companyId, period) {
  return this.find({
    companyId,
    status: "active",
    depreciationSchedule: {
      $elemMatch: { period, status: "pending" },
    },
  });
};

/**
 * Totals by category for dashboard stats.
 */
assetSchema.statics.getTotals = async function (companyId) {
  const result = await this.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        status: "active",
      },
    },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        totalCost: { $sum: "$acquisitionCost" },
        totalAccumulatedDep: { $sum: "$accumulatedDepreciation" },
        totalBookValue: { $sum: "$bookValue" },
      },
    },
  ]);
  return result;
};

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Generate the full depreciation schedule based on the asset's
 * depreciation method, useful life, salvage value and rate.
 * Resets accumulated depreciation and book value to "as-new".
 */
assetSchema.methods.generateSchedule = function () {
  this.depreciationSchedule = [];

  if (this.depreciationMethod === "none" || this.usefulLifeMonths === 0) {
    // No depreciation (e.g., land)
    this.bookValue = this.acquisitionCost;
    this.accumulatedDepreciation = 0;
    return;
  }

  const depreciableAmount = this.acquisitionCost - (this.salvageValue || 0);
  const startDate = new Date(this.depreciationStartDate);
  let month = startDate.getUTCMonth() + 1; // 1-12
  let year = startDate.getUTCFullYear();
  let accumulated = 0;
  let remainingBookValue = this.acquisitionCost;

  if (this.depreciationMethod === "straight_line") {
    const monthlyDep = depreciableAmount / this.usefulLifeMonths;
    const roundedMonthly = Math.round(monthlyDep);
    const totalRounded = roundedMonthly * this.usefulLifeMonths;
    const adjustment = depreciableAmount - totalRounded; // fix rounding on last entry

    for (let i = 0; i < this.usefulLifeMonths; i++) {
      const thisMonthDep =
        i === this.usefulLifeMonths - 1
          ? roundedMonthly + adjustment
          : roundedMonthly;
      accumulated += thisMonthDep;
      const bookValue = Math.max(
        this.salvageValue || 0,
        this.acquisitionCost - accumulated,
      );
      const period = `${year}-${String(month).padStart(2, "0")}`;
      this.depreciationSchedule.push({
        period,
        year,
        month,
        depreciationAmount: thisMonthDep,
        accumulatedDepreciation: accumulated,
        bookValue,
        status: "pending",
      });
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
  } else if (this.depreciationMethod === "reducing_balance") {
    // Monthly rate = annual rate / 12
    const monthlyRate = this.depreciationRate / 12;
    for (let i = 0; i < this.usefulLifeMonths; i++) {
      let depAmount = Math.round(remainingBookValue * monthlyRate);
      // Don't depreciate below salvage value
      if (remainingBookValue - depAmount < (this.salvageValue || 0)) {
        depAmount = Math.max(
          0,
          remainingBookValue - (this.salvageValue || 0),
        );
      }
      if (depAmount <= 0) break;
      accumulated += depAmount;
      remainingBookValue -= depAmount;
      const period = `${year}-${String(month).padStart(2, "0")}`;
      this.depreciationSchedule.push({
        period,
        year,
        month,
        depreciationAmount: depAmount,
        accumulatedDepreciation: accumulated,
        bookValue: remainingBookValue,
        status: "pending",
      });
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
  }

  this.accumulatedDepreciation = 0;
  this.bookValue = this.acquisitionCost;
};

/**
 * Record depreciation for a given period by marking the schedule
 * entry as posted and linking it to the journal entry.
 * Updates running accumulatedDepreciation and bookValue.
 * Returns the schedule entry, or null if none pending for that period.
 */
assetSchema.methods.recordDepreciation = function (period, journalEntryId) {
  const entry = this.depreciationSchedule.find(
    (s) => s.period === period && s.status === "pending",
  );
  if (!entry) return null;

  entry.status = "posted";
  entry.journalEntryId = journalEntryId;
  entry.postedAt = new Date();

  this.accumulatedDepreciation = entry.accumulatedDepreciation;
  this.bookValue = entry.bookValue;
  this.journalEntryIds.push(journalEntryId);

  return entry;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Asset = models?.Asset;

if (!Asset) {
  Asset = mongoose.model("Asset", assetSchema);
}

export default Asset;
export { Asset };

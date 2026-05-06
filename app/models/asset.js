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
// TRANSFER LOG SUB-SCHEMA
// ============================================
// Records location/department/custodian changes with date, user, reason.
// Append-only — preserves audit trail across the asset's lifetime.
// ============================================
const transferLogSchema = new Schema(
  {
    transferredAt: { type: Date, required: true, default: Date.now },
    fromLocation: { type: String, default: "" },
    toLocation: { type: String, default: "" },
    fromDepartment: { type: String, default: "" },
    toDepartment: { type: String, default: "" },
    fromAssignedToName: { type: String, default: "" },
    toAssignedToName: { type: String, default: "" },
    reason: { type: String, default: "" },
    transferredBy: {
      id: { type: String, required: true },
      name: { type: String, required: true },
    },
  },
  { _id: true, timestamps: false },
);

// ============================================
// IMPAIRMENT SUB-SCHEMA
// ============================================
// ============================================
// USAGE READING SUB-DOCUMENT
// ============================================
// Odometer/hours-meter readings for vehicles, machinery, equipment.
// Drives cost-per-km / cost-per-hour analytics.
const usageReadingSchema = new Schema(
  {
    recordedAt: { type: Date, required: true, default: Date.now },
    reading: { type: Number, required: true, min: 0 },
    unit: {
      type: String,
      enum: ["km", "miles", "hours"],
      required: true,
      default: "km",
    },
    source: {
      type: String,
      enum: ["manual", "fuel", "service", "transfer", "other"],
      default: "manual",
    },
    sourceRef: {
      kind: { type: String, enum: ["bill", "expense", null], default: null },
      id: { type: Schema.Types.ObjectId, default: null },
    },
    notes: String,
    recordedBy: {
      name: String,
      id: String,
    },
  },
  { _id: true, timestamps: true },
);

const impairmentLogSchema = new Schema(
  {
    impairedAt: { type: Date, required: true, default: Date.now },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
    journalEntryId: { type: Schema.Types.ObjectId, ref: "JournalEntry" },
    impairedBy: {
      id: { type: String, required: true },
      name: { type: String, required: true },
    },
  },
  { _id: true, timestamps: false },
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
        // Industry-standard PPE (Property, Plant & Equipment) categories.
        // Order roughly follows IFRS balance-sheet presentation: long-life
        // tangibles first, then movable, then short-life.
        "land",
        "building",
        "leasehold_improvement", // Tenant improvements amortized over lease term
        "vehicle",
        "machinery", // Plant & machinery
        "office_equipment", // Copiers, printers, AV, telephony, KRA Class II
        "computer", // Computer equipment, laptops, servers, KRA Class II
        "furniture", // Furniture & fittings
        "equipment", // General tools & equipment
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
    // First-period convention. "full_month" charges a full month even if
    // acquired late in the month (legacy default). "pro_rata" charges
    // proportional days in the first month and bleeds the remainder into
    // an extra final month — matches IFRS practice for material assets.
    depreciationConvention: {
      type: String,
      enum: ["full_month", "pro_rata"],
      default: "full_month",
    },

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

    // Transfer history (location / department / custodian changes)
    transfers: [transferLogSchema],

    // Impairment events (partial write-downs)
    impairments: [impairmentLogSchema],

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

    // ──────────────────────────────────────────
    // Usage tracking (odometer / hours-meter)
    // ──────────────────────────────────────────
    // Drives cost-per-km/hour analytics. Default unit follows category:
    //   vehicle  → km
    //   machinery / equipment → hours
    //   other → km (override at create time)
    usageUnit: {
      type: String,
      enum: ["km", "miles", "hours"],
      default: "km",
    },
    usageReadings: [usageReadingSchema],
    // Cached from latest entry of usageReadings — denormalized for fast
    // listing/filtering. Always recomputed on save by recordUsageReading.
    currentUsage: { type: Number, default: 0, min: 0 },
    lastReadingAt: Date,

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
    const convention = this.depreciationConvention || "full_month";

    // Pro-rata: figure out what fraction of the start month the asset is on the books for.
    // If startDay is 1, fraction is 1 (whole month). Otherwise, days from startDay to end of month.
    let firstFraction = 1;
    if (convention === "pro_rata") {
      const startDay = startDate.getUTCDate();
      // Days in start month: zero-th day of next month works in UTC.
      const daysInStartMonth = new Date(
        Date.UTC(year, month, 0),
      ).getUTCDate();
      if (startDay > 1 && daysInStartMonth > 0) {
        firstFraction = (daysInStartMonth - startDay + 1) / daysInStartMonth;
      }
    }

    const needsExtraMonth = firstFraction < 1;
    const totalMonths = this.usefulLifeMonths + (needsExtraMonth ? 1 : 0);
    const monthlyDepRaw = depreciableAmount / this.usefulLifeMonths;
    const fullMonthDep = Math.round(monthlyDepRaw);

    for (let i = 0; i < totalMonths; i++) {
      let thisMonthDep;
      if (i === totalMonths - 1) {
        // Always true up the very last entry to the exact depreciable amount.
        thisMonthDep = depreciableAmount - accumulated;
      } else if (i === 0 && firstFraction < 1) {
        thisMonthDep = Math.round(monthlyDepRaw * firstFraction);
      } else {
        thisMonthDep = fullMonthDep;
      }

      // Safety: never go negative or overshoot.
      if (thisMonthDep < 0) thisMonthDep = 0;
      if (accumulated + thisMonthDep > depreciableAmount) {
        thisMonthDep = depreciableAmount - accumulated;
      }

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
 * Apply an impairment write-down: increase accumulated depreciation,
 * reduce book value, and recompute the remaining depreciation schedule
 * over the same remaining months (IFRS-style revised carrying amount).
 * Caller is responsible for adding the impairment log entry and posting
 * the journal entry.
 */
assetSchema.methods.applyImpairment = function (amount) {
  if (!amount || amount <= 0) return;

  this.accumulatedDepreciation = (this.accumulatedDepreciation || 0) + amount;
  this.bookValue = Math.max(this.salvageValue || 0, (this.bookValue || 0) - amount);

  const pending = (this.depreciationSchedule || []).filter(
    (e) => e.status === "pending",
  );
  const remaining = pending.length;
  const newDepreciable = Math.max(
    0,
    this.bookValue - (this.salvageValue || 0),
  );

  if (remaining === 0 || newDepreciable === 0) {
    for (const e of pending) {
      e.depreciationAmount = 0;
      e.accumulatedDepreciation = this.accumulatedDepreciation;
      e.bookValue = this.bookValue;
      e.status = "skipped";
    }
    return;
  }

  if (this.depreciationMethod === "straight_line") {
    const newMonthly = Math.round(newDepreciable / remaining);
    let runningAcc = this.accumulatedDepreciation;
    let runningBV = this.bookValue;
    let distributed = 0;
    for (let i = 0; i < pending.length; i++) {
      const isLast = i === pending.length - 1;
      let dep = isLast ? newDepreciable - distributed : newMonthly;
      if (dep < 0) dep = 0;
      distributed += dep;
      runningAcc += dep;
      runningBV -= dep;
      pending[i].depreciationAmount = dep;
      pending[i].accumulatedDepreciation = runningAcc;
      pending[i].bookValue = Math.max(this.salvageValue || 0, runningBV);
    }
  } else if (this.depreciationMethod === "reducing_balance") {
    let bv = this.bookValue;
    let runningAcc = this.accumulatedDepreciation;
    const monthlyRate = this.depreciationRate / 12;
    for (let i = 0; i < pending.length; i++) {
      let dep = Math.round(bv * monthlyRate);
      if (bv - dep < (this.salvageValue || 0)) {
        dep = Math.max(0, bv - (this.salvageValue || 0));
      }
      runningAcc += dep;
      bv -= dep;
      pending[i].depreciationAmount = dep;
      pending[i].accumulatedDepreciation = runningAcc;
      pending[i].bookValue = bv;
      if (dep === 0) pending[i].status = "skipped";
    }
  }
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

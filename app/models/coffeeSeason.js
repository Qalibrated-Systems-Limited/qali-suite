import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// COFFEE SEASON MODEL
// Tracks a single harvest season at a coop
// collection centre.
//
// A season scopes all FarmerIntakeEntry records
// and carries the default price schedule so
// the connector can auto-price deliveries.
// ============================================

// Price schedule per grade within a season
const gradePriceSchema = new Schema(
  {
    grade:     { type: String, required: true }, // "AA", "AB", "C", "PB", "E", "TT", "UG"
    coffeeType:{ type: String, default: "parchment" }, // "cherry" | "parchment" | "mbuni"
    unitPrice: { type: Number, required: true, min: 0 }, // KES per kg
    currency:  { type: String, default: "KES" },
  },
  { _id: false }
);

const coffeeSeasonSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    // Human-readable name shown in the UI
    name: {
      type: String,
      required: true,
      trim: true,
      // e.g. "2024/25 Long Rains", "2025 Short Rains"
    },

    // Harvest season type
    seasonType: {
      type: String,
      enum: ["long_rains", "short_rains", "dry_season", "custom"],
      required: true,
    },

    // Calendar year the harvest starts (used for sorting / reporting)
    year: {
      type: Number,
      required: true,
    },

    startDate: { type: Date, default: null },
    endDate:   { type: Date, default: null },

    // Active season is the default when intake_created omits seasonRef
    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },

    // Target intake volume for this season (informational / reporting)
    targetVolumeKg: { type: Number, default: 0 },

    // Default price schedule — connector looks this up when payload has no unitPrice
    priceSchedule: [gradePriceSchema],

    // Product to credit with stock when coffee is received
    // If omitted, intake is recorded without a stock movement
    defaultProductId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },

    notes: { type: String, default: "" },

    createdBy: {
      id:   { type: String },
      name: { type: String },
    },
  },
  {
    timestamps: true,
    collection: "coffeeSeasons",
  }
);

// Compound index — only one active season per company at a time is enforced in
// the action layer (not as a DB unique index because isActive can be false for many).
coffeeSeasonSchema.index({ companyId: 1, year: -1, seasonType: 1 });
coffeeSeasonSchema.index({ companyId: 1, isActive: 1 });

// ── Helper: find the price for a grade/coffeeType within this season ──
coffeeSeasonSchema.methods.getPriceForGrade = function (grade, coffeeType) {
  const entry = this.priceSchedule.find(
    (p) => p.grade === grade && p.coffeeType === (coffeeType || "parchment")
  );
  return entry?.unitPrice ?? null;
};

const CoffeeSeason =
  mongoose.models.CoffeeSeason ||
  mongoose.model("CoffeeSeason", coffeeSeasonSchema);

export default CoffeeSeason;

// ── Export constants ──────────────────────────────────────
export const SEASON_TYPES = ["long_rains", "short_rains", "dry_season", "custom"];

export const SEASON_TYPE_LABELS = {
  long_rains:  "Long Rains",
  short_rains: "Short Rains",
  dry_season:  "Dry Season",
  custom:      "Custom Period",
};

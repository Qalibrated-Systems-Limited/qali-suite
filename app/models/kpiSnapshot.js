import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// KPI SNAPSHOT
// ============================================
// One row per (kpi, period). The target is frozen at record time
// so historical reads stay correct even if the KPI's current target
// is later edited. Computed-at + source flag let the UI show whether
// a number came from auto-computation or a manual entry.
// ============================================

const kpiSnapshotSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    kpiId: {
      type: Schema.Types.ObjectId,
      ref: "Kpi",
      required: true,
      index: true,
    },

    // Period the snapshot represents.
    //   monthly   → periodMonth is 1-12, periodQuarter unset
    //   quarterly → periodMonth is 3/6/9/12 (end-of-quarter), periodQuarter is 1-4
    //   yearly    → periodMonth is 12, periodQuarter is 4
    // The compound (year, month) index then handles all three cases without
    // duplicate snapshots — quarterly/yearly slot into specific months by convention.
    periodicity: {
      type: String,
      enum: ["monthly", "quarterly", "yearly"],
      default: "monthly",
      required: true,
    },
    periodYear: { type: Number, required: true },
    periodMonth: { type: Number, required: true, min: 1, max: 12 },
    periodQuarter: { type: Number, min: 1, max: 4, default: null },

    actualValue: {
      type: Number,
      required: true,
    },

    // Frozen target — the target on the Kpi definition at the moment this was recorded.
    targetAtTime: {
      type: Number,
      required: true,
    },

    // How this snapshot was produced.
    source: {
      type: String,
      enum: ["manual", "auto"],
      required: true,
    },

    notes: { type: String, maxlength: 500 },

    recordedBy: { name: String, id: String },
  },
  { timestamps: true }
);

// One snapshot per kpi per period.
kpiSnapshotSchema.index(
  { companyId: 1, kpiId: 1, periodYear: 1, periodMonth: 1 },
  { unique: true }
);
kpiSnapshotSchema.index({ companyId: 1, periodYear: 1, periodMonth: 1 });

export default mongoose.models.KpiSnapshot ||
  mongoose.model("KpiSnapshot", kpiSnapshotSchema);

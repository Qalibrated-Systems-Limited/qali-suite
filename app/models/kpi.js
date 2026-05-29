import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// KPI DEFINITION
// ============================================
// A KPI is a metric with a target, an owner, and a period.
// Snapshots (actuals) are stored separately in KpiSnapshot —
// one row per (kpi, period). Edits to the target on this
// definition do not retroactively change historical snapshots;
// each snapshot freezes the target that was active at the time.
// ============================================

const kpiSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },

    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: 80,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // What family of business activity this measures.
    category: {
      type: String,
      required: true,
      enum: ["financial", "operational", "hr", "customer", "compliance"],
      index: true,
    },

    // Where the actual value comes from.
    //   manual                    — user enters per period
    //   monthly_revenue           — Cr-Dr on revenue accounts (posted JEs in period)
    //   monthly_payroll_cost      — gross payroll + employer contributions for runs paid in period
    //   ar_days_outstanding       — open AR balance ÷ recent daily revenue
    //   cash_position             — balance of cash/bank/mpesa accounts at period end
    //   active_headcount          — count of employees with active/probation status
    //   gross_margin_percent      — (revenue - COGS) ÷ revenue × 100
    //   opex_ratio                — non-COGS expenses ÷ revenue × 100
    //   payroll_to_revenue_ratio  — payroll cost ÷ revenue × 100
    //   avg_order_value           — revenue ÷ count of completed invoices in period
    source: {
      type: String,
      required: true,
      enum: [
        "manual",
        "monthly_revenue",
        "monthly_payroll_cost",
        "ar_days_outstanding",
        "cash_position",
        "active_headcount",
        "gross_margin_percent",
        "opex_ratio",
        "payroll_to_revenue_ratio",
        "avg_order_value",
      ],
      default: "manual",
    },

    // How to display the value.
    unit: {
      type: String,
      required: true,
      enum: ["currency", "percentage", "days", "count", "ratio"],
      default: "currency",
    },

    periodicity: {
      type: String,
      required: true,
      enum: ["monthly", "quarterly", "yearly"],
      default: "monthly",
    },

    target: {
      type: Number,
      required: [true, "Target is required"],
    },

    // Higher actual = better (revenue, headcount) vs. lower = better (AR days, costs).
    // Drives whether being above-target is green or red.
    targetDirection: {
      type: String,
      required: true,
      enum: ["higher_is_better", "lower_is_better"],
      default: "higher_is_better",
    },

    // Custom status thresholds — override the default 95% / 80% bands.
    // Stored as ratios (0.95 = 95% of target). Direction matters:
    //   higher_is_better → on_target if actual/target ≥ onTargetThreshold
    //                      near_target if actual/target ≥ nearTargetThreshold
    //                      off_target otherwise
    //   lower_is_better  → on_target if actual/target ≤ onTargetThreshold
    //                      near_target if actual/target ≤ nearTargetThreshold
    //                      off_target otherwise
    customThresholds: {
      onTargetThreshold: { type: Number, default: null },   // null = use default
      nearTargetThreshold: { type: Number, default: null },
    },

    // Custom status labels — override defaults ("on track" / "at risk" / "behind").
    statusLabels: {
      onTarget: { type: String, default: null },
      nearTarget: { type: String, default: null },
      offTarget: { type: String, default: null },
    },

    // Owner — accountable person. Canonical refs follow the same shape used
    // elsewhere in HR (partyId is the canonical employee id; profileId / userId
    // are secondary). Snapshot fields keep list views fast (no $lookup).
    owner: {
      partyId: { type: Schema.Types.ObjectId, ref: "Party" },
      profileId: { type: Schema.Types.ObjectId, ref: "EmployeeProfile" },
      userId: { type: Schema.Types.ObjectId, ref: "User" },
      name: String,
      employeeNumber: String,
    },

    isActive: { type: Boolean, default: true, index: true },

    createdBy: { name: String, id: String },
    lastModifiedBy: { name: String, id: String },
  },
  { timestamps: true }
);

kpiSchema.index({ companyId: 1, isActive: 1 });
kpiSchema.index({ companyId: 1, category: 1, isActive: 1 });

export default mongoose.models.Kpi || mongoose.model("Kpi", kpiSchema);

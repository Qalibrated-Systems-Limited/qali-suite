import mongoose from "mongoose";

const subscriptionAuditLogSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    action: {
      type: String,
      enum: [
        "plan_changed",
        "status_changed",
        "trial_started",
        "trial_extended",
        "max_users_changed",
        "renewed",
        "cancelled",
        "auto_expired",
      ],
      required: true,
    },
    previous: {
      plan: String,
      status: String,
      maxUsers: Number,
      trialEndsAt: Date,
      currentPeriodStart: Date,
      currentPeriodEnd: Date,
    },
    updated: {
      plan: String,
      status: String,
      maxUsers: Number,
      trialEndsAt: Date,
      currentPeriodStart: Date,
      currentPeriodEnd: Date,
    },
    changedBy: {
      name: String,
      id: String,
    },
    reason: String,
  },
  { timestamps: true }
);

subscriptionAuditLogSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.models.SubscriptionAuditLog || mongoose.model("SubscriptionAuditLog", subscriptionAuditLogSchema);

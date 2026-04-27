import mongoose from "mongoose";

const planConfigSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      enum: ["free", "starter", "professional", "enterprise"],
    },
    label: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      default: 0,
    },
    currency: {
      type: String,
      default: "KES",
    },
    maxUsers: {
      type: Number,
      required: true,
      default: 5,
      // -1 = unlimited
    },
    modules: {
      type: [String],
      required: true,
      default: [],
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    description: String,
  },
  { timestamps: true }
);

planConfigSchema.index({ sortOrder: 1 });

export default mongoose.models.PlanConfig ||
  mongoose.model("PlanConfig", planConfigSchema);

import mongoose from "mongoose";

const Schema = mongoose.Schema;

const bridgeConfigs = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },
    isLocked: { required: true, type: Number, max: 1, min: 0 },

    maxCapacity: {
      required: [true, "Please enter max capacity"],
      type: Number,
      default: 80000,
    },

    minCapacity: {
      required: [true, "Please enter min capacity"],
      type: Number,
      default: 400,
    },

    division: {
      default: 20,
      type: Number,
    },
    weigherId: {
      type: String,
      default: "WB001",
    },
  },
  { timestamps: true }
);

// Indexes
// One config per company per weigher
bridgeConfigs.index({ companyId: 1, weigherId: 1 }, { unique: true });

const models = mongoose.models;
let BridgeConfig = models ? models.BridgeConfig : null;
if (BridgeConfig) {
  BridgeConfig = BridgeConfig;
} else {
  BridgeConfig = mongoose.model("BridgeConfig", bridgeConfigs);
}

export default BridgeConfig;

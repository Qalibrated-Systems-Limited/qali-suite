import mongoose from "mongoose";

const Schema = mongoose.Schema;

const bridgeConfigs = new Schema(
  {
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

const models = mongoose.models;
let BridgeConfig = models ? models.BridgeConfig : null;
if (BridgeConfig) {
  BridgeConfig = BridgeConfig;
} else {
  BridgeConfig = mongoose.model("BridgeConfig", bridgeConfigs);
}

export default BridgeConfig;

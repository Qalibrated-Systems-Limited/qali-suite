import mongoose from "mongoose";

const Schema = mongoose.Schema;

const commodityRouteSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },
    name: {
      required: [true, "Please enter route name"],
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Indexes
// Unique route name per company
commodityRouteSchema.index({ companyId: 1, name: 1 }, { unique: true });

const models = mongoose.models;
let CommodityRoute = models ? models.CommodityRoute : null;
if (CommodityRoute) {
  CommodityRoute = CommodityRoute;
} else {
  CommodityRoute = mongoose.model("CommodityRoute", commodityRouteSchema);
}

export default CommodityRoute;

import mongoose from "mongoose";

const Schema = mongoose.Schema;

const commodityRouteSchema = new Schema(
  {
    name: {
      required: [true, "Please enter route name"],
      type: String,
      trim: true,

      unique: true,
    },
  },
  { timestamps: true }
);

const models = mongoose.models;
let CommodityRoute = models ? models.CommodityRoute : null;
if (CommodityRoute) {
  CommodityRoute = CommodityRoute;
} else {
  CommodityRoute = mongoose.model("CommodityRoute", commodityRouteSchema);
}

export default CommodityRoute;

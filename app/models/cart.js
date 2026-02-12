import mongoose from "mongoose";
import { type } from "os";

const Schema = mongoose.Schema;

const nestedSchema = new Schema({
  name: String,
  id: String,
  quantity: Number,
  unitPrice: Number,
  unit: {type: String, enum: ["pcs", "kg", "litre", "mtr"], default: "pcs"},
  type: {type : String, enum: ["stock", "service"] , default: "stock"},
  serialNo: String,
});

const cartSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },
    userId: { required: true, type: String },

    items: [nestedSchema],
  },
  { timestamps: true }
);

// Indexes
// User can only have one cart per company
cartSchema.index({ companyId: 1, userId: 1 }, { unique: true });

const models = mongoose.models;
let Cart = models ? models.Cart : null;
if (Cart) {
  Cart = Cart;
} else {
  Cart = mongoose.model("Cart", cartSchema);
}

export default Cart;

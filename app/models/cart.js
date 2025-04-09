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
    userId: { required: true, type: String },

    items: [nestedSchema],
  },
  { timestamps: true }
);

const models = mongoose.models;
let Cart = models ? models.Cart : null;
if (Cart) {
  Cart = Cart;
} else {
  Cart = mongoose.model("Cart", cartSchema);
}

export default Cart;

import mongoose from "mongoose";
import { units } from "../utils/units";

const Schema = mongoose.Schema;

const productSchema =
  Schema &&
  new Schema(
    {
      price: { type: Number, required: true },

      SKU: {
        type: String,
        required: true,
        unique: true,
      },

      description: {
        type: String,
        required: true,
      },
      unit: {
        type: String,
        enum: units,
        default: "pcs",
      },
      category: {
        type: String,
      },
      name: {
        type: String,
        required: true,
      },
      stock: { type: Number, required: true },
    },
    { timestamps: true }
  );

// Encrypting password before saving vehicle

// Compare vehicle password
// Generate password reset token

const models = mongoose.models;
let Product = models ? models.Product : null;
if (Product) {
  Product = Product;
} else {
  Product = mongoose.model("Product", productSchema);
}

export default Product;

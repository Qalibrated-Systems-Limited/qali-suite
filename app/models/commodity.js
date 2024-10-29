import mongoose from "mongoose";

const Schema = mongoose.Schema;

const commoditySchema = new Schema(
  {
    creator: {
      name: { required: true, type: String },
      id: { required: true, type: String },
    },

    name: {
      type: String,
      required: true,
      unique: true,
    },
    code: String,
  },
  { timestamps: true }
);

// Encrypting password before saving vehicle

// Compare vehicle password
// Generate password reset token

const models = mongoose.models;
let Commodity = models ? models.Commodity : null;
if (Commodity) {
  Commodity = Commodity;
} else {
  Commodity = mongoose.model("Commodity", commoditySchema);
}

export default Commodity;

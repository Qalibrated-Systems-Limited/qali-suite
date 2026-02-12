import mongoose from "mongoose";

const Schema = mongoose.Schema;

const commoditySchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },
    creator: {
      name: { required: true, type: String },
      id: { required: true, type: String },
    },

    name: {
      type: String,
      required: true,
    },
    code: String,
  },
  { timestamps: true }
);

// Encrypting password before saving vehicle

// Compare vehicle password
// Generate password reset token

// Indexes
// Unique commodity name per company
commoditySchema.index({ companyId: 1, name: 1 }, { unique: true });

const models = mongoose.models;
let Commodity = models ? models.Commodity : null;
if (Commodity) {
  Commodity = Commodity;
} else {
  Commodity = mongoose.model("Commodity", commoditySchema);
}

export default Commodity;

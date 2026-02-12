import mongoose from "mongoose";

const Schema = mongoose.Schema;

const tranSchema = new Schema(
  {
    // Company (Tenant)
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true,
    },
    invoiceWeight: Number,
    containerNumber: String,

    driver: {
      name: String,
      id: { required: true, type: String },
    },

    customer: {
      name: { required: true, type: String },
      id: String,
    },

    commodity: {
      type: String,
      required: true,
    },
    source: String,
    destination: String,

    vehRegNo: { type: String, required: true },
    firstWeight: {
      date: {
        type: Date,
        default: new Date(),
        immutable: true,
      },

      value: {
        type: Number,
        min: 400,
        captureType: {
          type: String,
          default: "auto",
        },

        required: true,
        immutable: true,
        unit: { type: String, default: "Kg" },
      },

      user: {
        type: String,
        required: true,
        immutable: true,
      },
    },
    isComplete: {
      type: Boolean,
      default: false,
    },

    secondWeight: {
      date: {
        type: Date,
        default: new Date(),
      },
      captureType: {
        type: String,
        default: "auto",
      },

      value: {
        type: Number,
        min: 400,

        unit: { type: String, default: "Kg" },
      },

      user: {
        type: String,
      },
    },

    status: {
      type: String,
      default: "Active",
    },
  },
  { timestamps: true }
);

// Indexes
// Query indexes - prefixed with companyId for tenant isolation
tranSchema.index({ companyId: 1, createdAt: -1 });
tranSchema.index({ companyId: 1, vehRegNo: 1 });
tranSchema.index({ companyId: 1, "customer.id": 1 });
tranSchema.index({ companyId: 1, isComplete: 1, status: 1 });

const models = mongoose.models;
let Transaction = models ? models.Transaction : null;
if (Transaction) {
  Transaction = Transaction;
} else {
  Transaction = mongoose.model("Transaction", tranSchema);
}

export default Transaction;

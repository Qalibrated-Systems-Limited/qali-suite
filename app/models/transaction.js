import mongoose from "mongoose";

const Schema = mongoose.Schema;

const tranSchema = new Schema(
  {
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

const models = mongoose.models;
let Transaction = models ? models.Transaction : null;
if (Transaction) {
  Transaction = Transaction;
} else {
  Transaction = mongoose.model("Transaction", tranSchema);
}

export default Transaction;

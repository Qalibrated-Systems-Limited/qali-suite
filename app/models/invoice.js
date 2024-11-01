import mongoose from "mongoose";

const Schema = mongoose.Schema;

const invoiceSchema =
  Schema &&
  new Schema(
    {
      description: {
        type: String,
        required: true,
      },
      customer: {
        name: { type: String, required: true },
        address: { type: String, required: true },

        id: { type: String, required: true },
        email: String,
        phone: String,
      },

      currency: { type: String, required: true, default: "KES" },
      discount: { type: Number, default: 0 },
      taxRate: { type: Number, default: 16 },
      paymentMethod: {
        type: String,
        enum: ["Credit Card", "Bank Transfer", "Cash"],
        default: "Cash",
      },
      invoiceNumber: { type: String, required: true, unique: true },

      items: [
        {
          name: String,
          id: String,
          quantity: Number,
          unitPrice: Number,
          unit: String,
          type: String,
        },
      ],
      status: {
        type: String,
        required: true,
        default: "Unpaid",
      },
    },
    { timestamps: true }
  );

const models = mongoose.models;
let Invoice = models ? models.Invoice : null;
if (Invoice) {
  Invoice = Invoice;
} else {
  Invoice = mongoose.model("Invoice", invoiceSchema);
}

export default Invoice;

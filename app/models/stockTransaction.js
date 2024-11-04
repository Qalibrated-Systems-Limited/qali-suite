import mongoose from "mongoose";

const Schema = mongoose.Schema;

const stockTransactionSchema = new Schema({
  SKU: {
    type: String,

    required: true,
  },
  ref: String,
  amount: { required: true, type: Number },
  quantity: { type: Number, required: true },
  transactionType: {
    type: String,
    required: true,
    enum: ["Purchase", "Sale", "Adjustment"],
  },
  date: { type: Date, default: Date.now },
  referenceId: String,
});

const models = mongoose.models;
let StockTransaction = models ? models.StockTransaction : null;
if (StockTransaction) {
  StockTransaction = StockTransaction;
} else {
  StockTransaction = mongoose.model("StockTransaction", stockTransactionSchema);
}

export default StockTransaction;

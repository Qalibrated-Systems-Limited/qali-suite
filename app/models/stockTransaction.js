import mongoose from "mongoose";

const Schema = mongoose.Schema;

const stockTransactionSchema = new Schema({
  // Company (Tenant)
  companyId: {
    type: Schema.Types.ObjectId,
    ref: "Company",
    required: [true, "Company ID is required"],
    index: true,
  },
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

// Indexes
// Query indexes - prefixed with companyId for tenant isolation
stockTransactionSchema.index({ companyId: 1, SKU: 1, date: -1 });
stockTransactionSchema.index({ companyId: 1, transactionType: 1, date: -1 });

const models = mongoose.models;
let StockTransaction = models ? models.StockTransaction : null;
if (StockTransaction) {
  StockTransaction = StockTransaction;
} else {
  StockTransaction = mongoose.model("StockTransaction", stockTransactionSchema);
}

export default StockTransaction;

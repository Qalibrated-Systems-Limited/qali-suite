import mongoose from "mongoose";
import { type } from "os";

const nestedSchema = new mongoose.Schema({
  name: String,
  id: String,
  quantity: Number,
  unitPrice: Number,
  unit: { type: String, default: "pcs" },
  type: { type: String, default: "Stock" },
  serialNo: [String],
});
const deliveryNoteSchema = new mongoose.Schema({
  // Company (Tenant)
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: [true, "Company ID is required"],
    index: true,
  },
  deliveryNumber: { type: String, required: true },
  date: { type: Date, default: Date.now },
  reason: String,

  customer: {
    name: { type: String, required: true },
    address: { type: String, default: "Nairobi" },
    phone: String,
    id: String,
  },
  shouldBeReturned: { type: Boolean, default: true },
  technician: {
    name: String,

    id: String,
  },
  items: [nestedSchema],
  createdBy: {
    name: String,
    id: String,
  },

  notes: { type: String },
});

// Indexes
// Unique delivery number per company
deliveryNoteSchema.index({ companyId: 1, deliveryNumber: 1 }, { unique: true });
// Query indexes
deliveryNoteSchema.index({ companyId: 1, date: -1 });
deliveryNoteSchema.index({ companyId: 1, "customer.id": 1 });
deliveryNoteSchema.index({ companyId: 1, "technician.id": 1 });

const models = mongoose.models;
let DeliveryNote = models ? models.DeliveryNote : null;
if (DeliveryNote) {
  DeliveryNote = DeliveryNote;
} else {
  DeliveryNote = mongoose.model("DeliveryNote", deliveryNoteSchema);
}

export default DeliveryNote;

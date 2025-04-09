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
  deliveryNumber: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  reason: String,

  customer: { 
    name: { type: String, required: true },
    address: { type: String, required: true },
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

const models = mongoose.models;
let DeliveryNote = models ? models.DeliveryNote : null;
if (DeliveryNote) {
  DeliveryNote = DeliveryNote;
} else {
  DeliveryNote = mongoose.model("DeliveryNote", deliveryNoteSchema);
}

export default DeliveryNote;

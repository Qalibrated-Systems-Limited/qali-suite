import mongoose from "mongoose";

const nestedSchema = new mongoose.Schema({
  description: { type: String },
  quantity: { type: Number },
  unitPrice: { type: Number },
  total: { type: Number },
});
const deliveryNoteSchema = new mongoose.Schema({
  deliveryNumber: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  customer: {
    name: { type: String, required: true },
    address: { type: String, required: true },
    phone: String,
    id: String,
  },
  items: [nestedSchema],

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

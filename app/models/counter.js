import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

const models = mongoose.models;
let Counter = models ? models.Counter : null;
if (!Counter) {
  Counter = mongoose.model("Counter", counterSchema);
}

export default Counter;

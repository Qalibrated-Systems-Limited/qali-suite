import mongoose from "mongoose";

const Schema = mongoose.Schema;

const accountSchema = new Schema(
  {
    creator: {
      name: { required: true, type: String },
      id: { required: true, type: String },
    },
    name: { required: [true, "Please enter name"], type: String, unique: true },

    phoneNumber: String,

    email: String,
    address: { type: String, required: true },

    status: {
      type: String,
      default: "Active",
    },
  },
  { timestamps: true }
);

const models = mongoose.models;
let Account = models ? models.Account : null;
if (Account) {
  Account = Account;
} else {
  Account = mongoose.model("Account", accountSchema);
}

export default Account;

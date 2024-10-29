import mongoose from "mongoose";

const Schema = mongoose.Schema;

const vehicleSchema =
  Schema &&
  new Schema(
    {
      creator: {
        name: { required: true, type: String },
        id: { required: true, type: String },
      },

      status: {
        type: String,
        default: "Active",
      },
      countryCode: {
        type: String,
        default: "KE",
      },
      vehicleType: { type: String, default: "Truck" },
      tareWeight: Number,
      trailerNo: String,

      numberPlate: {
        type: String,
        required: [true, "Please enter number plate"],
        unique: true,
        uppercase: true,
      },
    },
    { timestamps: true }
  );

// Encrypting password before saving vehicle

// Compare vehicle password
// Generate password reset token

vehicleSchema.statics.findByPlate = async function (numberPlate) {
  return this.findOne({ numberPlate });
};

vehicleSchema.statics.add = async function (
  numberPlate,
  tareWeight,
  vehicleType,
  countryCode,
  creator
) {
  const vehicle = new this({
    numberPlate,
    tareWeight,
    vehicleType,
    countryCode,
    creator,
  });
  await vehicle.save();
  return vehicle;
};

const models = mongoose.models;
let Vehicle = models ? models.Vehicle : null;
if (Vehicle) {
  Vehicle = Vehicle;
} else {
  Vehicle = mongoose.model("Vehicle", vehicleSchema);
}

export default Vehicle;

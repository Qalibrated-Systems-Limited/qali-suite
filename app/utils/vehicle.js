const { validateNumberPlate } = require("./validators");

export const addVehicle = async (req) => {
  const { numberPlate, countryCode, vehicleType, tareWeight } = req;

  const plate = numberPlate.toUpperCase();
  const code = countryCode ?? "KE";
  if (!validateNumberPlate(plate, code)) {
    return new Response(JSON.stringify({ message: "Invalid number plate" }), {
      status: 422,
    });
  }
  const creator = { name: req.userName, id: req.userId };
  const result = await Vehicle.add(
    plate,
    tareWeight,
    vehicleType,
    countryCode,
    creator
  );

  return result;
};

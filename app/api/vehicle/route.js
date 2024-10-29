import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Vehicle from "../../models/vehicles";
import { authErrorResponse, okResponse } from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";
import { validateNumberPlate } from "../../utils/validators";

export async function POST(req) {
  await isAuth(req);
  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }
  try {
    dbConnect();

    const creator = { name: req.userName, id: req.userId };

    const { numberPlate, countryCode, vehicleType, tareWeight, trailerNo } =
      await req.json();

    const plate = numberPlate.toUpperCase();
    const code = countryCode ?? "KE";

    if (!validateNumberPlate(plate, code)) {
      return new Response(JSON.stringify({ message: "Invalid number plate" }), {
        status: 422,
      });
    }
    const newVehicle = new Vehicle({
      numberPlate: plate,
      tareWeight,
      vehicleType,
      countryCode,
      trailerNo,
      creator,
    });
    const result = await newVehicle.save();

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function PUT(req) {
  //Check if user is authenticated

  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }
  const { id, numberPlate, countryCode, vehicleType, trailerNo } =
    await req.json();
  const plate = numberPlate.toUpperCase();
  const code = countryCode ?? "KE";

  if (!validateNumberPlate(plate, code)) {
    return new Response(JSON.stringify({ message: "Invalid number plate" }), {
      status: 422,
    });
  }

  try {
    dbConnect();

    const result = await Vehicle.findByIdAndUpdate(id, {
      numberPlate: plate,
      vehicleType,
      trailerNo,
    });

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    errorHandlers(e);
  }
}

export async function PATCH(req) {
  await isAuth(req);
  if (!req.isAuth) {
    return authErrorResponse("Cannot deactivate");
  }

  try {
    const { id } = await req.json();

    const result = await Vehicle.findByIdAndUpdate(id, { status: "Inactive" });

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

export async function DELETE(req) {
  isAuth(req);
  if (!req.isAuth) {
    return authErrorResponse("Cannot deactivate");
  }

  try {
    const { id } = await req.json();

    const result = await Vehicle.findByIdAndDelete(id);

    if (result) {
      return okResponse("ok");
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

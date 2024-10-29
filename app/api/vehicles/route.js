import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Vehicle from "../../models/vehicles";
import { authErrorResponse, okResponse } from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("You must login first");
  }

  try {
    dbConnect();

    const matchStage = { $match: { status: "Active" } };

    const sortStage = { $sort: { createdAt: -1 } };

    const projectStage = {
      $project: { numberPlate: 1, vehicleType: 1, tareWeight: 1 },
    };

    const pipeline = [matchStage, sortStage, projectStage];

    const result = await Vehicle.aggregate(pipeline);

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Account from "../../models/account";

import { authErrorResponse, okResponse } from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("You must login first");
  }

  try {
    await dbConnect();

    const matchStage = { $match: { status: "Active", accountType: "Driver" } };

    const sortStage = { $sort: { createdAt: -1 } };

    const projectStage = {
      $project: {
        name: 1,
        email: 1,
        nationalId: 1,
        phoneNumber: 1,
        address: 1,
        id: "$_id",
      },
    };

    const pipeline = [matchStage, sortStage, projectStage];

    const result = await Account.aggregate(pipeline);

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

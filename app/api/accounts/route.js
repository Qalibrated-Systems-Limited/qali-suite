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
    dbConnect();

    const matchStage = {
      $match: { status: "Active" },
    };

    const sortStage = { $sort: { createdAt: -1 } };

    const projectStage = {
      $project: {
        name: 1,
        email: 1,
        accountType: "$accountType",
        nationalId: 1,
        phoneNumber: 1,
        address: 1,
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

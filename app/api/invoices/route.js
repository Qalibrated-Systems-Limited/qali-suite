import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Invoice from "../../models/invoice";

import { authErrorResponse, okResponse } from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("You must login first");
  }

  try {
    dbConnect();

    const limitStage = { $limit: 500 };
    const sortStage = { $sort: { createdAt: -1 } };

    const pipeline = [sortStage, limitStage];

    const result = await Invoice.aggregate(pipeline);

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

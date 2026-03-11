import dbConnect from "../../../config/dbConnect";
import { isAuth } from "../../../middlewares/auth";
import Invoice from "../../../models/invoice";

import { authErrorResponse, okResponse } from "../../../utils/customres";
import { errorHandlers } from "../../../utils/errorHandler";

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("You must login first");
  }

  try {
    await dbConnect();

    const limitStage = { $limit: 10 };
    const sortStage = { $sort: { createdAt: -1 } };

    const addFieldsStage = {
      $addFields: {
        date: { $dateToString: { format: "%d-%m-%Y", date: "$createdAt" } },
      },
    };

    const pipeline = [sortStage, limitStage, addFieldsStage];
    const result = await Invoice.aggregate(pipeline);

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

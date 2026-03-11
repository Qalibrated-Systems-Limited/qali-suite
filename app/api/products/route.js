import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Product from "../../models/product";

import { authErrorResponse, okResponse } from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("You must login first");
  }

  try {
    await dbConnect();

    const limitStage = { $limit: 500 };
    const sortStage = { $sort: { createdAt: -1 } };
    const projectStage = { $project: { SKU: 1, _id: 0 } };

    const pipeline = [projectStage, sortStage, limitStage];

    const result = await Product.aggregate(pipeline);

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

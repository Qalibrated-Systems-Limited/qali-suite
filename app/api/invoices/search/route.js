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

  const searchParams = req.nextUrl.searchParams;
  const query = searchParams.get("query");

  try {
    await dbConnect();

    const searchStage = {
      $search: {
        index: "default", // Name of the full-text search index
        text: {
          query: query,
          path: {
            wildcard: "*",
          },
        },
      },
    };

    const limitStage = { $limit: 500 };
    const sortStage = { $sort: { createdAt: -1 } };

    let pipeline = [sortStage, limitStage];
    if (query && query.length > 0) {
      pipeline = [searchStage, limitStage];
    }

    const result = await Invoice.aggregate(pipeline);

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
}

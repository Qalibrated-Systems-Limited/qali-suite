import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Routes from "../../models/commodityRoutes";
import {
  authErrorResponse,
  failedResponse,
  okResponse,
} from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

//Fetch recently added transactions
export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not authenticated");
  }

  try {
    dbConnect();

    const matchStage = {
      $match: {
        name: { $ne: null },
      },
    };

    const sortStage = { $sort: { updatedAt: -1 } };
    const limitStage = { $limit: 1000 };

    const projectStage = {
      $project: {
        name: 1,
      },
    };

    const pipeline = [matchStage, sortStage, limitStage, projectStage];

    const result = await Routes.aggregate(pipeline);

    if (result) {
      return okResponse(result);
    }
    return failedResponse();
  } catch (e) {
    return errorHandlers(e);
  }
}

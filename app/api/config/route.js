import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import BridgeConfig from "../../models/bridgeConfigs";
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

    const result = await BridgeConfig.findOne({ weigherId: "WB/FEED/001" });

    if (result) {
      return okResponse(result);
    }
    return failedResponse("Failed");
  } catch (e) {
    return errorHandlers(e);
  }
}

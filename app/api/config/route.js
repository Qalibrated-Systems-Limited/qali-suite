import { isAuth } from "../../middlewares/auth";
import { getBridgeConfig } from "../../mongodb/queries/weighbridge-queries";
import {
  authErrorResponse,
  failedResponse,
  okResponse,
} from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not authenticated");
  }

  try {
    const result = await getBridgeConfig(req.companyId);
    return result ? okResponse(result) : failedResponse("Not configured");
  } catch (e) {
    return errorHandlers(e);
  }
}

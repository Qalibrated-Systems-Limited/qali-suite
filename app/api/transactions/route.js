import { isAuth } from "../../middlewares/auth";
import { getCompletedTransactions } from "../../mongodb/queries/weighbridge-queries";
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
    const result = await getCompletedTransactions(req.companyId);
    return result ? okResponse(result) : failedResponse();
  } catch (e) {
    return errorHandlers(e);
  }
}

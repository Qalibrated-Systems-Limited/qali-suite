import { isAuth } from "../../../middlewares/auth";

import {
  quartelySummary,
  quarterlySalesDistro,
} from "../../../mongodb/queries/queries";
import {
  authErrorResponse,
  failedResponse,
  okResponse,
} from "../../../utils/customres";
import { errorHandlers } from "../../../utils/errorHandler";

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not authorized");
  }

  try {
    const result = await quarterlySalesDistro();
    return okResponse(result);
  } catch (e) {
    return failedResponse();
  }
}

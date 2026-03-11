import { isAuth } from "../../middlewares/auth";
import { getActiveVehicles } from "../../mongodb/queries/weighbridge-queries";
import { authErrorResponse, okResponse } from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("You must login first");
  }

  try {
    const result = await getActiveVehicles(req.companyId);
    return result ? okResponse(result) : okResponse([]);
  } catch (e) {
    return errorHandlers(e);
  }
}

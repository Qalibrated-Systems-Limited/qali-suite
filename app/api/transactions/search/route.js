import { isAuth } from "../../../middlewares/auth";
import { searchTransactions } from "../../../mongodb/queries/weighbridge-queries";
import { authErrorResponse, okResponse } from "../../../utils/customres";
import { errorHandlers } from "../../../utils/errorHandler";

export async function GET(request) {
  await isAuth(request);

  if (!request.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    const query = request.nextUrl.searchParams.get("query");
    const result = await searchTransactions(query, request.companyId);
    return result ? okResponse(result) : okResponse([]);
  } catch (e) {
    return errorHandlers(e);
  }
}

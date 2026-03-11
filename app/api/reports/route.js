import { isAuth } from "../../middlewares/auth";
import { getWeighbridgeReport } from "../../mongodb/queries/weighbridge-queries";
import {
  authErrorResponse,
  failedResponse,
  okResponse,
} from "../../utils/customres";

export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not authorized");
  }

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const customer = searchParams.get("customer");
  const vehicle = searchParams.get("vehicle");
  const commodity = searchParams.get("commodity");

  let startDate = start ? new Date(start) : new Date();
  startDate.setUTCHours(0, 0, 0, 0);

  let endDate = end ? new Date(end) : new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 1);

  try {
    const result = await getWeighbridgeReport({
      startDate,
      endDate,
      customer,
      vehicle,
      commodity,
      companyId: req.companyId,
    });
    return okResponse(result);
  } catch (e) {
    return failedResponse();
  }
}

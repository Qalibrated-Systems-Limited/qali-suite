import { isAuth } from "../../middlewares/auth";
import Transaction from "../../models/transaction";
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

  let matchStage = {
    $match: {
      "secondWeight.date": { $gte: startDate, $lte: endDate },
      status: "Active",
      isComplete: true,
      "secondWeight.value": { $gte: 400 },
      ...(customer && { "customer.name": customer }),
      ...(vehicle && { veRegNo: vehicle }),
      ...(commodity && { commodity }),
    },
  };

  const groupStage = {
    $group: {
      _id: null,
      totalWeight: {
        $sum: {
          $abs: { $subtract: ["$secondWeight.value", "$firstWeight.value"] },
        },
      },
      count: { $sum: 1 },
    },
  };

  try {
    const result = await Transaction.aggregate([matchStage, groupStage]);
    return okResponse(result);
  } catch (e) {
    return failedResponse();
  }
}

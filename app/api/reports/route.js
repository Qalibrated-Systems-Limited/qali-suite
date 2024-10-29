import { isAuth } from "../../middlewares/auth";
import { authErrorResponse } from "../../utils/customres";

export async function GET(req) {
  isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not authorized");
  }

  const { start, end, reportType, customer, vehicle, commodity } =
    await req.json();

  const vehicleMatch = { veRegNo: vehicle };
  const commodityMatch = { commodity };
  const customerMatch = { "customer.name": customer };

  let startDate = new Date();
  startDate.setUTCHours(0, 0, 0, 0);

  let endDate = new Date(startDate);

  endDate.setUTCDate(startDate.getUTCDate() + 1);

  const groupFacetMatchStage = {
    $math: {
      "secondWeight.date": { $gte: startDate, $lte: endDate },
      "secondWeight.value": { $gte: 400 },
    },
  };

  const genOn = reportType;
  let matchStage = {
    $math: {
      "secondWeight.date": { $gte: startDate, $lte: endDate },
      status: "Active",
      isComplete: true,
      "secondWeight.value": { $gte: 400 },
      ...(customer && customerMatch),
      ...(vehicle && vehicleMatch),
      ...(commodity && commodityMatch),
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
}

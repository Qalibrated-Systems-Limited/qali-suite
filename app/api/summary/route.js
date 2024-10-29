import { isAuth } from "../../middlewares/auth";
import Transaction from "../../models/transaction";
import { authErrorResponse, okResponse } from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

export async function GET(req) {
  isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not authorized");
  }

  let today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let startDate = today;
  startDate.setUTCDate(today.getUTCDate - 1);

  let endDate = today;

  today.setUTCDate(today.getUTCDate() + 1);

  const matchStage2 = {
    $match: {
      "secondWeight.date": {
        $gte: new Date(new Date().setDate(new Date().getDate() - 6)), // Last one week (including today)
        $lt: new Date(), // Up to
      },
    },
  };

  const matchStage1 = {
    $match: {
      status: "Active",
      "secondWeight.value": { $gte: 400 },
    },
  };

  const groupStage = {
    $group: {
      _id: {
        $cond: {
          if: {
            $eq: [
              {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$secondWeight.date",
                },
              },
              { $dateToString: { format: "%Y-%m-%d", date: new Date() } },
            ],
          }, // Check if it's today
          then: "today",
          else: "thisWeek",
        },
      },
      totalWeight: {
        $sum: {
          $abs: { $subtract: ["$secondWeight.value", "$firstWeight.value"] },
        },
      },

      count: { $sum: 1 }, // Replace "weight" with the actual field name for weight
    },
  };
  const pipeline2 = [matchStage2, groupStage];
  const sortStage = { $sort: { "secondWeight.date": -1 } };
  const limitStage = { $limit: 700 };

  const projectStage = {
    $project: {
      firstWeight: "$firstWeight.value",
      secondWeight: "$secondWeight.value",
      commodity: 1,
      customer: "$customer.name",
      invoiceWeight: 1,
      user1: "$firstWeight.user",
      user2: "$secondWeight.user",
      destination: 1,
      vehicle: "$vehRegNo",
      source: 1,
      driver: "$driver.name",
      id: "$_id",

      date2: "$secondWeight.date",
      net: {
        $abs: { $subtract: ["$firstWeight.value", "$secondWeight.value"] },
      },

      date: "$createdAt",
    },
  };

  const pipeline1 = [sortStage, limitStage, projectStage];
  const facetStage = {
    $facet: {
      summary: pipeline2,
      recentTx: pipeline1,
    },
  };

  const combinedPipeline = [matchStage1, facetStage];

  try {
    const result = await Transaction.aggregate(combinedPipeline);
    if (result) {
      console.log(result);
      return okResponse(result);
    }
  } catch (err) {
    return errorHandlers(err);
  }
}

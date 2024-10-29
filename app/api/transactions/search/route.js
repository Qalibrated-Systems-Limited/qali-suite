import dbConnect from "../../../config/dbConnect";
import { isAuth } from "../../../middlewares/auth";
import Transaction from "../../../models/transaction";
import { authErrorResponse, okResponse } from "../../../utils/customres";
import { errorHandlers } from "../../../utils/errorHandler";

export const GET = async (request) => {
  await isAuth(request);

  if (!request.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    dbConnect();
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("query");

    const searchStage = {
      $search: {
        index: "transactionSearchIndex", // Name of the atlas search index
        text: {
          query: query,
          path: {
            wildcard: "*",
          },
        },
      },
    };

    const sortStage = { $sort: { createdAt: -1 } };

    const limitStage = { $limit: 1000 };

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
        driverId: "$driver.id",
        accountId: "$customer.id",

        date2: {
          $dateToString: {
            format: "%d/%m/%G %H:%M",
            date: "$secondWeight.date",
          },
        },
        net: {
          $abs: { $subtract: ["$firstWeight.value", "$secondWeight.value"] },
        },

        date: {
          $dateToString: { format: "%d/%m/%G %H:%M", date: "$createdAt" },
        },
      },
    };

    let pipeline = [sortStage, limitStage, projectStage];
    if (query && query.length > 0) {
      pipeline = [searchStage, sortStage, limitStage, projectStage];
    }

    const result = await Transaction.aggregate(pipeline);

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
};

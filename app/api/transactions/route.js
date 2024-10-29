import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Transaction from "../../models/transaction";
import {
  authErrorResponse,
  failedResponse,
  okResponse,
} from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";

//Fetch recently added transactions
export async function GET(req) {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not authenticated");
  }

  try {
    dbConnect();

    const matchStage = {
      $match: {
        status: "Active",
        "secondWeight.value": { $gt: 399 },
        isComplete: true,
      },
    };

    const sortStage = { $sort: { updatedAt: -1 } };
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
        containerNumber: 1,

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

    const pipeline = [matchStage, sortStage, limitStage, projectStage];

    const result = await Transaction.aggregate(pipeline);

    if (result) {
      return okResponse(result);
    }
    return failedResponse();
  } catch (e) {
    return errorHandlers(e);
  }
}

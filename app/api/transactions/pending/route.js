import dbConnect from "../../../config/dbConnect";
import { isAuth } from "../../../middlewares/auth";
import Transaction from "../../../models/transaction";
import { authErrorResponse, okResponse } from "../../../utils/customres";
import { errorHandlers } from "../../../utils/errorHandler";

export const GET = async (req) => {
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not allowed");
  }

  try {
    dbConnect();

    const matchStage = {
      $match: {
        status: "Active",
        "secondWeight.value": { $exists: false },
        isComplete: false,
      },
    };

    const sortStage = { $sort: { createdAt: -1 } };

    const limitStage = { $limit: 1000 };

    const projectStage = {
      $project: {
        firstWeight: "$firstWeight.value",

        customer: "$customer.name",

        user1: "$firstWeight.user",
        commodity: 1,

        destination: 1,
        vehicle: "$vehRegNo",
        source: 1,
        driverId: "$driver.id",
        accountId: "$customer.id",
        driver: "$driver.name",
        id: "$_id",

        date: {
          $dateToString: {
            format: "%d/%m/%G %H:%M",
            date: "$firstWeight.date",
          },
        },
      },
    };
    const pipeline = [matchStage, sortStage, limitStage, projectStage];

    const result = await Transaction.aggregate(pipeline);

    if (result) {
      return okResponse(result);
    }
  } catch (e) {
    return errorHandlers(e);
  }
};

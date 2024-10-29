import { isAuth } from "../../../middlewares/auth";

import Transaction from "../../../models/transaction";
import BridgeConfig from "../../../models/bridgeConfigs";

import {
  authErrorResponse,
  failedResponse,
  okResponse,
} from "../../../utils/customres";
import dbConnect from "../../../config/dbConnect";

export async function GET(req, props) {
  const params = await props.params;
  await isAuth(req);
  if (!req.isAuth) {
    return authErrorResponse("Not authorized to add transaction");
  }

  try {
    dbConnect();
    const configs = await BridgeConfig.findOne({ weigherId: "WB/FEED/001" });

    if (!configs || configs.isLocked == 1) {
      return authErrorResponse("Weighbridge locked by admin");
    }
    const id = params.id;

    const result = await Transaction.findOne(
      { _id: id },
      {
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
        containerNumber: 1,
        driver: "$driver.name",
        id: "$_id",
        driverId: "$driver.id",
        accountId: "$customer.id",

        time2: {
          $dateToString: {
            format: "%H:%M",
            date: "$secondWeight.date",
          },
        },

        date2: {
          $dateToString: {
            format: "%d-%m-%G",
            date: "$secondWeight.date",
          },
        },
        net: {
          $abs: { $subtract: ["$firstWeight.value", "$secondWeight.value"] },
        },

        date: {
          $dateToString: { format: "%d-%m-%G ", date: "$firstWeight.date" },
        },
        time: {
          $dateToString: { format: "%H:%M", date: "$firstWeight.date" },
        },
      }
    );

    return okResponse(result);
  } catch (e) {
    return failedResponse("Could not get ticket");
  }
}

export async function PUT(req, props) {
  const params = await props.params;
  await isAuth(req);

  if (!req.isAuth) {
    return authErrorResponse("Not authorized to add transaction");
  }

  dbConnect();

  try {
    const id = params.id;

    await Transaction.findOneAndUpdate(
      { _id: id },
      { $set: { status: "Inactive" } }
    );

    return okResponse("Deactivated");
  } catch (e) {
    console.log(e);
    return failedResponse();
  }
}

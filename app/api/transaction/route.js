import dbConnect from "../../config/dbConnect";
import { isAuth } from "../../middlewares/auth";
import Account from "../../models/account";
import BridgeConfig from "../../models/bridgeConfigs";
import Commodity from "../../models/commodity";
import CommodityRoute from "../../models/commodityRoutes";
import Transaction from "../../models/transaction";
import Vehicle from "../../models/vehicles";
import { clientSideErrorResponse, valResponse } from "../../utils/customres";
import {
  authErrorResponse,
  failedResponse,
  okResponse,
} from "../../utils/customres";
import { errorHandlers } from "../../utils/errorHandler";
import { toTitle, validateNumberPlate } from "../../utils/validators";

//Take first weight

export async function POST(req) {
  await isAuth(req);

  if (!["Admin", "Operator"].includes(req.role)) {
    return authErrorResponse("Not authorized to add transaction");
  }

  const creator = { id: req.userId, name: req.userName };

  try {
    dbConnect();
    const configs = await BridgeConfig.findOne({ weigherId: "WB/FEED/001" });

    if (!configs || configs.isLocked === 1) {
      return authErrorResponse("Weighbridge locked by admin or not configured");
    }
    dbConnect();

    let operator = req.userName;
    if (operator.includes(" ")) {
      operator = operator.split(" ")[0];
    }

    const {
      weight,
      numberPlate,
      commodityName,
      accountName,
      accountId,
      driverName,
      driverId,
      source,
      date,
      containerNumber,
      vehicleId,
      commodityId,
      destination,
    } = await req.json();

    const modDest = toTitle(destination) ?? "";
    const modSource = toTitle(source) ?? "";
    const modAccount = toTitle(accountName) ?? "";
    const modDriver = toTitle(driverName) ?? "";
    const modVehicle = numberPlate.toUpperCase() ?? "";
    const modCommodity = toTitle(commodityName) ?? "";
    if (
      modAccount.length < 2 ||
      modDriver.length < 2 ||
      modVehicle.length < 2 ||
      modCommodity.length < 2
    ) {
      return valResponse("Invalid input some required fields are missing");
    }

    //Check if the vehicle is having a pending transaction
    const pendingTransaction = await Transaction.findOne({
      vehRegNo: numberPlate.toUpperCase(),
      isComplete: false,
      status: "Active",
    });
    if (pendingTransaction) {
      console.log("pending ticket");
      return clientSideErrorResponse(
        `The vehicle ${numberPlate.toUpperCase()} has a pending transaction`
      );
    }

    if (modSource && modSource.length > 0) {
      await CommodityRoute.findOneAndUpdate(
        { name: modSource },
        { name: modSource },
        { upsert: true }
      );
    }

    if (modDest && modDest.length > 0) {
      await CommodityRoute.findOneAndUpdate(
        { name: modSource },
        { name: modSource },
        { upsert: true }
      );
    }
    const upperNumberPlate = numberPlate.toUpperCase();

    const existingVehicle = await Vehicle.findOne({ numberPlate: modVehicle });

    if (!existingVehicle) {
      const numberPlateIsValid = validateNumberPlate(upperNumberPlate, "KE");

      if (!numberPlateIsValid) {
        console.log("Invalid numberPlate");
        return clientSideErrorResponse("Invalid vehicle");
      }
      const newVehicle = new Vehicle({
        numberPlate: upperNumberPlate,
        creator,
      });

      const vehResult = await newVehicle.save();

      if (!vehResult) {
        return clientSideErrorResponse("Could not save vehicle");
      }
    }

    let customerId = accountId;

    const existingAccount = await Account.findOne({ name: modAccount });

    if (!existingAccount) {
      const account = new Account({ name: modAccount, creator });

      const existingAccount = await account.save();
      if (existingAccount) {
        customerId = existingAccount._id;
      }
    }
    ``;
    let createdDriverId = driverId;

    const existingDriver = await Account.findOne({ name: modDriver });
    if (!existingDriver) {
      const newDriver = new Account({
        name: modDriver,
        accountType: "Driver",
        creator: { id: req.userId, name: req.userName },
      });

      const result = await newDriver.save();
      createdDriverId = result._id;
    } else {
      createdDriverId = existingDriver._id.toString();
    }

    const existingCommodity = await Commodity.findOne({ name: modCommodity });

    if (!existingCommodity) {
      const newCommodity = new Commodity({
        name: modCommodity,
        creator,
      });
      await newCommodity.save();
    }

    const firstWeight = { value: weight, date: date, user: operator };
    const driver = { id: createdDriverId, name: modDriver };
    const customer = { name: modAccount, id: customerId };

    let containerNo = "";
    if (containerNumber) {
      containerNo = containerNumber.toUpperCase();
    }

    const tran = new Transaction({
      firstWeight,

      commodity: modCommodity,
      customer,
      driver,
      containerNumber: containerNo,
      vehRegNo: numberPlate.toUpperCase(),

      source: modSource,
      destination: modDest,
    });

    const result = await tran.save();

    return okResponse(result);
  } catch (e) {
    console.log(e);
    return errorHandlers(e);
  }
}

//Take second weight

export async function PUT(req) {
  dbConnect();
  await isAuth(req);

  if (!["Admin", "Operator"].includes(req.role)) {
    return authErrorResponse("Not authorized to add transaction");
  }

  const configs = await BridgeConfig.findOne({ weigherId: "WB/FEED/001" });

  if (!configs || configs.isLocked === 1) {
    return authErrorResponse("Weighbridge locked by admin or not configured");
  }

  const creator = { id: req.userId, name: req.userName };

  const {
    weight,
    date,

    commodityName,

    destination,
    source,

    tranId,
    driverName,
    driverId,
    accountName,
    accountId,
    vehRegNo,
  } = await req.json();

  if (!weight || parseFloat(weight) < 400) {
    return clientSideErrorResponse("Second weight cannot be less than 400");
  }

  try {
    dbConnect();
    const modDest = toTitle(destination) ?? "";
    const modSource = toTitle(source) ?? "";
    const modAccount = toTitle(accountName) ?? "";
    const modDriver = toTitle(driverName) ?? "";
    const modVehicle = vehRegNo.toUpperCase() ?? "";
    const modCommodity = toTitle(commodityName) ?? "";
    if (
      modAccount.length < 2 ||
      modDriver.length < 2 ||
      modVehicle.length < 2 ||
      modCommodity.length < 2
    ) {
      return valResponse("Invalid input some required fields are missing");
    }
    if (modDest && modDest.length > 0) {
      await CommodityRoute.findOneAndUpdate(
        { name: modDest },
        { name: modDest },
        { upsert: true, new: true }
      );
    }
    if (modSource && modSource.length > 0) {
      await CommodityRoute.findOneAndUpdate(
        { name: modSource },
        { name: modSource },
        { upsert: true, new: true }
      );
    }

    let customerId = accountId;
    const existingAccount = await Account.findOne({ name: modAccount });

    if (!existingAccount) {
      const account = new Account({
        name: modAccount,
        creator,
        accountType: "Customer",
      });

      const existingAccount = await account.save();
      if (existingAccount) {
        customerId = existingAccount._id;
      }
    } else {
      customerId = existingAccount._id.toString();
    }
    ``;
    let createdDriverId = driverId;
    const existingDriver = await Account.findOne({
      name: modDriver,
    });

    if (!existingDriver) {
      const newDriver = new Account({
        name: modDriver,

        creator: { id: req.userId, name: req.userName },
      });

      const result = await newDriver.save();
      createdDriverId = result._id;
    } else {
      createdDriverId = existingDriver._id.toString();
    }

    let operator = req.userName;
    if (operator.includes(" ")) {
      operator = operator.split(" ")[0];
    }

    const secondWeight = { value: weight, user: operator, date: date };

    const result = await Transaction.findByIdAndUpdate(
      tranId,
      {
        secondWeight,
        vehRegNo: modVehicle,
        commodity: toTitle(commodityName),
        driver: { name: modDriver, id: createdDriverId },
        customer: { name: modAccount, id: customerId },

        isComplete: true,
        destination: modDest,
      },
      {
        new: true,
        projection: {
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
      }
    );

    if (result) {
      return okResponse(result);
    }
    return failedResponse();
  } catch (e) {
    return errorHandlers(e);
  }
}

// Archive or deactivate  transaction

export async function PATCH(req) {
  isAuth(req);

  if (!["Admin", "Operator"].includes(req.role)) {
    return authErrorResponse("Not authorized to add transaction");
  }

  const { id } = await req.json();

  try {
    const result = await Transaction.findByIdAndUpdate(id, {
      status: "Inactive",
    });

    if (result) {
      return okResponse(result);
    }
    return failedResponse();
  } catch (e) {
    return errorHandlers(e);
  }
}

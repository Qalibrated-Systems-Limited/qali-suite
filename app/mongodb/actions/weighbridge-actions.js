"use server";

import dbConnect from "@/app/config/dbConnect";
import Transaction from "@/app/models/transaction";
import Vehicle from "@/app/models/vehicles";
import Account from "@/app/models/account";
import Commodity from "@/app/models/commodity";
import CommodityRoute from "@/app/models/commodityRoutes";
import BridgeConfig from "@/app/models/bridgeConfigs";
import { toTitle, validateNumberPlate } from "@/app/utils/validators";

// ============================================
// HELPERS
// ============================================

async function ensureRoute(name, companyId) {
  if (name && name.length > 0) {
    await CommodityRoute.findOneAndUpdate(
      { name, companyId },
      { name, companyId },
      { upsert: true, new: true }
    );
  }
}

async function ensureVehicle(numberPlate, companyId, creator) {
  const existing = await Vehicle.findOne({ numberPlate, companyId });
  if (existing) return existing;

  if (!validateNumberPlate(numberPlate, "KE")) {
    throw new Error("Invalid vehicle number plate");
  }

  return await new Vehicle({ numberPlate, companyId, creator }).save();
}

async function ensureAccount(name, companyId, creator, accountType = "Customer") {
  const existing = await Account.findOne({ name, companyId });
  if (existing) return existing;

  return await new Account({ name, accountType, companyId, creator }).save();
}

async function ensureCommodity(name, companyId, creator) {
  const existing = await Commodity.findOne({ name, companyId });
  if (existing) return existing;

  return await new Commodity({ name, companyId, creator }).save();
}

function getOperatorName(userName) {
  return userName.includes(" ") ? userName.split(" ")[0] : userName;
}

// ============================================
// TRANSACTION ACTIONS
// ============================================

export async function checkBridgeLocked(companyId, weigherId = "WB/FEED/001") {
  await dbConnect();
  const configs = await BridgeConfig.findOne({ weigherId, companyId });
  if (!configs || configs.isLocked === 1) {
    return { error: "Weighbridge locked by admin or not configured" };
  }
  return { configs };
}

export async function takeFirstWeight({
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
  destination,
  companyId,
  creator,
}) {
  await dbConnect();

  const modDest = toTitle(destination) ?? "";
  const modSource = toTitle(source) ?? "";
  const modAccount = toTitle(accountName) ?? "";
  const modDriver = toTitle(driverName) ?? "";
  const modVehicle = numberPlate.toUpperCase();
  const modCommodity = toTitle(commodityName) ?? "";

  if (
    modAccount.length < 2 ||
    modDriver.length < 2 ||
    modVehicle.length < 2 ||
    modCommodity.length < 2
  ) {
    return { error: "Invalid input: some required fields are missing" };
  }

  // Check for pending transaction on this vehicle
  const pending = await Transaction.findOne({
    vehRegNo: modVehicle,
    isComplete: false,
    status: "Active",
    companyId,
  });
  if (pending) {
    return { error: `Vehicle ${modVehicle} has a pending transaction` };
  }

  // Ensure related records exist
  await ensureRoute(modSource, companyId);
  await ensureRoute(modDest, companyId);
  await ensureVehicle(modVehicle, companyId, creator);

  const customer = await ensureAccount(modAccount, companyId, creator, "Customer");
  const driver = await ensureAccount(modDriver, companyId, creator, "Driver");
  await ensureCommodity(modCommodity, companyId, creator);

  const operator = getOperatorName(creator.name);

  const tran = new Transaction({
    companyId,
    firstWeight: { value: weight, date, user: operator },
    commodity: modCommodity,
    customer: { name: modAccount, id: customer._id.toString() },
    driver: { name: modDriver, id: driver._id.toString() },
    containerNumber: containerNumber ? containerNumber.toUpperCase() : "",
    vehRegNo: modVehicle,
    source: modSource,
    destination: modDest,
  });

  const result = await tran.save();
  return { data: result };
}

export async function takeSecondWeight({
  tranId,
  weight,
  date,
  commodityName,
  destination,
  source,
  driverName,
  driverId,
  accountName,
  accountId,
  vehRegNo,
  companyId,
  creator,
}) {
  await dbConnect();

  if (!weight || parseFloat(weight) < 400) {
    return { error: "Second weight cannot be less than 400" };
  }

  const modDest = toTitle(destination) ?? "";
  const modSource = toTitle(source) ?? "";
  const modAccount = toTitle(accountName) ?? "";
  const modDriver = toTitle(driverName) ?? "";
  const modVehicle = vehRegNo.toUpperCase();
  const modCommodity = toTitle(commodityName) ?? "";

  if (
    modAccount.length < 2 ||
    modDriver.length < 2 ||
    modVehicle.length < 2 ||
    modCommodity.length < 2
  ) {
    return { error: "Invalid input: some required fields are missing" };
  }

  // Ensure related records exist
  await ensureRoute(modDest, companyId);
  await ensureRoute(modSource, companyId);

  const customer = await ensureAccount(modAccount, companyId, creator, "Customer");
  const driver = await ensureAccount(modDriver, companyId, creator, "Driver");

  const operator = getOperatorName(creator.name);
  const secondWeight = { value: weight, user: operator, date };

  const result = await Transaction.findByIdAndUpdate(
    tranId,
    {
      secondWeight,
      vehRegNo: modVehicle,
      commodity: modCommodity,
      driver: { name: modDriver, id: driver._id.toString() },
      customer: { name: modAccount, id: customer._id.toString() },
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

  return result ? { data: result } : { error: "Transaction not found" };
}

export async function deactivateTransaction(id) {
  await dbConnect();
  const result = await Transaction.findByIdAndUpdate(id, {
    status: "Inactive",
  });
  return result ? { data: result } : { error: "Transaction not found" };
}

// ============================================
// VEHICLE ACTIONS
// ============================================

export async function createVehicle({
  numberPlate,
  countryCode = "KE",
  vehicleType,
  tareWeight,
  trailerNo,
  companyId,
  creator,
}) {
  await dbConnect();
  const plate = numberPlate.toUpperCase();

  if (!validateNumberPlate(plate, countryCode)) {
    return { error: "Invalid number plate" };
  }

  const vehicle = new Vehicle({
    numberPlate: plate,
    tareWeight,
    vehicleType,
    countryCode,
    trailerNo,
    companyId,
    creator,
  });

  const result = await vehicle.save();
  return { data: result };
}

export async function updateVehicle({
  id,
  numberPlate,
  countryCode = "KE",
  vehicleType,
  trailerNo,
}) {
  await dbConnect();
  const plate = numberPlate.toUpperCase();

  if (!validateNumberPlate(plate, countryCode)) {
    return { error: "Invalid number plate" };
  }

  const result = await Vehicle.findByIdAndUpdate(id, {
    numberPlate: plate,
    vehicleType,
    trailerNo,
  });
  return result ? { data: result } : { error: "Vehicle not found" };
}

export async function deactivateVehicle(id) {
  await dbConnect();
  const result = await Vehicle.findByIdAndUpdate(id, { status: "Inactive" });
  return result ? { data: result } : { error: "Vehicle not found" };
}

export async function deleteVehicle(id) {
  await dbConnect();
  const result = await Vehicle.findByIdAndDelete(id);
  return result ? { data: result } : { error: "Vehicle not found" };
}

// ============================================
// COMMODITY ACTIONS
// ============================================

export async function createCommodity({ name, code, companyId, creator }) {
  await dbConnect();
  const commodity = new Commodity({ name, code, companyId, creator });
  const result = await commodity.save();
  return { data: result };
}

export async function deleteCommodity(id) {
  await dbConnect();
  const result = await Commodity.findByIdAndDelete(id);
  return result ? { data: result } : { error: "Commodity not found" };
}

import dbConnect from "@/app/config/dbConnect";
import Transaction from "@/app/models/transaction";
import Vehicle from "@/app/models/vehicles";
import Account from "@/app/models/account";
import Commodity from "@/app/models/commodity";
import CommodityRoute from "@/app/models/commodityRoutes";
import BridgeConfig from "@/app/models/bridgeConfigs";
import { unstable_noStore as noStore } from "next/cache";

// ============================================
// TRANSACTION QUERIES
// ============================================

const TRANSACTION_PROJECTION = {
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
  containerNumber: 1,
  date2: {
    $dateToString: { format: "%d/%m/%G %H:%M", date: "$secondWeight.date" },
  },
  net: {
    $abs: { $subtract: ["$firstWeight.value", "$secondWeight.value"] },
  },
  date: {
    $dateToString: { format: "%d/%m/%G %H:%M", date: "$createdAt" },
  },
};

export async function getCompletedTransactions(companyId) {
  await dbConnect();
  noStore();

  const pipeline = [
    {
      $match: {
        status: "Active",
        "secondWeight.value": { $gt: 399 },
        isComplete: true,
        ...(companyId && { companyId }),
      },
    },
    { $sort: { updatedAt: -1 } },
    { $limit: 1000 },
    { $project: TRANSACTION_PROJECTION },
  ];

  return Transaction.aggregate(pipeline);
}

export async function getPendingTransactions(companyId) {
  await dbConnect();
  noStore();

  const pipeline = [
    {
      $match: {
        status: "Active",
        "secondWeight.value": { $exists: false },
        isComplete: false,
        ...(companyId && { companyId }),
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 1000 },
    {
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
          $dateToString: { format: "%d/%m/%G %H:%M", date: "$firstWeight.date" },
        },
      },
    },
  ];

  return Transaction.aggregate(pipeline);
}

export async function getTransactionById(id) {
  await dbConnect();
  noStore();

  return Transaction.findOne(
    { _id: id },
    {
      ...TRANSACTION_PROJECTION,
      time2: {
        $dateToString: { format: "%H:%M", date: "$secondWeight.date" },
      },
      date2: {
        $dateToString: { format: "%d-%m-%G", date: "$secondWeight.date" },
      },
      date: {
        $dateToString: { format: "%d-%m-%G ", date: "$firstWeight.date" },
      },
      time: {
        $dateToString: { format: "%H:%M", date: "$firstWeight.date" },
      },
    }
  );
}

export async function searchTransactions(query, companyId) {
  await dbConnect();
  noStore();

  const searchStage = {
    $search: {
      index: "transactionSearchIndex",
      text: {
        query,
        path: { wildcard: "*" },
      },
    },
  };

  const pipeline = [
    ...(query && query.length > 0 ? [searchStage] : []),
    { $sort: { createdAt: -1 } },
    { $limit: 1000 },
    { $project: TRANSACTION_PROJECTION },
  ];

  return Transaction.aggregate(pipeline);
}

// ============================================
// VEHICLE QUERIES
// ============================================

export async function getActiveVehicles(companyId) {
  await dbConnect();
  noStore();

  const pipeline = [
    { $match: { status: "Active", ...(companyId && { companyId }) } },
    { $sort: { createdAt: -1 } },
    { $project: { numberPlate: 1, vehicleType: 1, tareWeight: 1 } },
  ];

  return Vehicle.aggregate(pipeline);
}

// ============================================
// ACCOUNT QUERIES (weighbridge-specific)
// ============================================

export async function getActiveAccounts(companyId) {
  await dbConnect();
  noStore();

  const pipeline = [
    { $match: { status: "Active", ...(companyId && { companyId }) } },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        name: 1,
        email: 1,
        accountType: 1,
        nationalId: 1,
        phoneNumber: 1,
        address: 1,
      },
    },
  ];

  return Account.aggregate(pipeline);
}

// ============================================
// COMMODITY QUERIES
// ============================================

export async function getCommodities(companyId) {
  await dbConnect();
  noStore();

  return Commodity.find(companyId ? { companyId } : {}).sort({ createdAt: -1 });
}

// ============================================
// ROUTE QUERIES
// ============================================

export async function getCommodityRoutes(companyId) {
  await dbConnect();
  noStore();

  const pipeline = [
    { $match: { name: { $ne: null }, ...(companyId && { companyId }) } },
    { $sort: { updatedAt: -1 } },
    { $limit: 1000 },
    { $project: { name: 1 } },
  ];

  return CommodityRoute.aggregate(pipeline);
}

// ============================================
// CONFIG QUERIES
// ============================================

export async function getBridgeConfig(companyId, weigherId = "WB/FEED/001") {
  await dbConnect();
  noStore();

  return BridgeConfig.findOne({
    weigherId,
    ...(companyId && { companyId }),
  });
}

// ============================================
// REPORT QUERIES
// ============================================

export async function getWeighbridgeReport({
  startDate,
  endDate,
  customer,
  vehicle,
  commodity,
  companyId,
}) {
  await dbConnect();

  const matchStage = {
    $match: {
      "secondWeight.date": { $gte: startDate, $lte: endDate },
      status: "Active",
      isComplete: true,
      "secondWeight.value": { $gte: 400 },
      ...(customer && { "customer.name": customer }),
      ...(vehicle && { vehRegNo: vehicle }),
      ...(commodity && { commodity }),
      ...(companyId && { companyId }),
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

  return Transaction.aggregate([matchStage, groupStage]);
}

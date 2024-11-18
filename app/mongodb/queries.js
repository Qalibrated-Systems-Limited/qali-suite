import dbConnect from "../config/dbConnect";
import Vehicles from "../models/vehicles";
import Transactions from "../models/transaction";
import Product from "../models/product";
import { unstable_noStore as noStore } from "next/cache";

import Accounts from "../models/account";
import Vehicle from "../models/vehicles";
import Commodity from "../models/commodity";
import User from "../models/user";

import Invoice from "../models/invoice";

import BridgeConfig from "../models/bridgeConfigs";
import StockTransaction from "../models/stockTransaction";
import { format } from "date-fns";

dbConnect();

export const fetchTodaySummary = async () => {
  noStore();
  const matchStage1 = {
    $match: {
      "firstWeight.date": {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)), // Start of today (midnight)
        $lt: new Date(new Date().setHours(23, 59, 59, 999)), // End of today
      },
    },
  };

  const sortStage = {};

  const matchStage2 = {
    $match: {
      "firstWeight.date": {
        $gte: new Date(
          new Date().setDate(new Date().getDate() - new Date().getDay() + 1)
        ), // Start of the week (Monday)
        $lt: new Date(
          new Date().setDate(new Date().getDate() - new Date().getDay() + 8)
        ), // Start of next week (Monday)
      },
    },
  };
  const facetStage = {
    $facet: {
      today: [
        matchStage1,
        {
          $group: {
            _id: null,

            totalRecords: { $sum: 1 },

            totalNetWeight: {
              $sum: {
                $abs: {
                  $subtract: ["$secondWeight.value", "$firstWeight.value"],
                },
              },
            },
          },
        },
      ],

      thisWeek: [
        matchStage2,

        {
          $group: {
            _id: null,

            totalRecords: { $sum: 1 },

            totalNetWeight: {
              $sum: {
                $abs: {
                  $subtract: ["$secondWeight.value", "$firstWeight.value"],
                },
              },
            },
          },
        },
      ],
      matSummaryThisWeek: [
        matchStage2,
        {
          $group: {
            _id: "$commodity",
            totalRecords: { $sum: 1 },

            totalNetWeight: {
              $sum: {
                $abs: {
                  $subtract: ["$secondWeight.value", "$firstWeight.value"],
                },
              },
            },
          },
        },
      ],
    },
  };

  const matchStage = {
    $match: {
      isComplete: true,
    },
  };

  const pipeline = [matchStage, facetStage];

  const result = await Transactions.aggregate(pipeline);
  return result;
};

export const getVehicles = async () => {
  const vehicles = await Vehicle.find();
  return vehicles.map((veh) => {
    return { _id: veh._id.toString(), name: veh.numberPlate };
  });
};

export const getCommodity = async () => {
  const vehicles = await Commodity.find();
  return vehicles.map((veh) => {
    return { _id: veh._id.toString(), name: veh.name };
  });
};

export const getCustomers = async () => {
  const vehicles = await Accounts.find();
  return vehicles.map((veh) => {
    return { _id: veh._id.toString(), name: veh.name };
  });
};

export const fetchCardsData = async () => {
  noStore();
  const customers = await Accounts.countDocuments({ isActive: true });
  const transactions = await Transactions.countDocuments();
  const vehicles = await Vehicles.countDocuments();

  const data = await Promise.all([transactions, vehicles, customers]);

  const numberOfTrans = Number(data[0] ?? "0");
  const numberOfVehicles = Number(data[1] ?? "0");
  const numberOfAccounts = Number(data[2] ?? "0");

  return { numberOfTrans, numberOfAccounts, numberOfVehicles };
};
const ITEMS_PER_PAGE = 10;

export const monthlyAggregates = async () => {
  noStore();
  const matchStage = {
    $match: {
      "firstWeight.date": {
        $gte: new Date(new Date().getFullYear(), 0, 1),
        $lt: new Date(new Date().getFullYear() + 1, 0, 1),
      },

      isComplete: true,
      status: "Active",
    },
  };

  const groupStage = {
    $group: {
      _id: {
        month: { $dateToString: { format: "%b", date: "$firstWeight.date" } },
        monthNum: {
          $dateToString: { format: "%m", date: "$firstWeight.date" },
        },
      },

      totalRecords: { $sum: 1 },
      totalFirstWeight: { $sum: "$firstWeight.value" },
      totalSecondWeight: { $sum: "$secondWeight.value" },
      totalNetWeight: {
        $sum: {
          $abs: { $subtract: ["$secondWeight.value", "$firstWeight.value"] },
        },
      },
    },
  };
  const pipeline = [matchStage, groupStage, { $sort: { "_id.monthNum": 1 } }];

  const result = await Transactions.aggregate(pipeline);

  return result;
};

export const weeklyAggregates = async () => {
  const matchStage = {
    $match: {
      isComplete: true,
      "firstWeight.date": {
        $gte: new Date(
          new Date().setDate(new Date().getDate() - new Date().getDay() + 1)
        ), // Start of the week (Monday)
        $lt: new Date(
          new Date().setDate(new Date().getDate() - new Date().getDay() + 8)
        ), // Start of next week (Monday)
      },
    },
  };

  const groupStage = {
    $group: {
      _id: {
        date: { $dateToString: { format: "%d-%b", date: "$firstWeight.date" } },
        dateNum: { $dateToString: { format: "%d", date: "$firstWeight.date" } },
      },

      totalRecords: { $sum: 1 },
      totalFirstWeight: { $sum: "$firstWeight.value" },
      totalSecondWeight: { $sum: "$secondWeight.value" },

      totalNetWeightOutbound: {
        $sum: {
          $cond: {
            if: { $gt: ["$secondWeight.value", "$firstWeight.value"] }, // Check if secondWeight > firstWeight
            then: { $subtract: ["$secondWeight.value", "$firstWeight.value"] }, // Subtract when true
            else: 0,
          },
        },
      },
      totalNetWeightInbound: {
        $sum: {
          $cond: {
            if: { $gt: ["$firstWeight.value", "$secondWeight.value"] }, // Check if firstWeight > secondWeight
            then: { $subtract: ["$firstWeight.value", "$secondWeight.value"] }, // Subtract when true
            else: 0,
          },
        },
      },
      totalNetWeight: {
        $sum: {
          $abs: { $subtract: ["$secondWeight.value", "$firstWeight.value"] },
        },
      },
    },
  };
  const pipeline = [matchStage, groupStage, { $sort: { "_id.dateNum": 1 } }];

  const result = await Transactions.aggregate(pipeline);

  return result;
};

//Users queries
export const searchUsers = async (searchTerm, page = 1) => {
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  try {
    const searchStage = {
      $search: {
        index: "userSearchIndex", // Name of the full-text search index
        text: {
          query: searchTerm,
          path: {
            wildcard: "*",
          },
        },
      },
    };

    const paginationStage = [
      { $skip: skipRecords }, // Skip records for pagination
      { $limit: ITEMS_PER_PAGE }, // Limit results per page
    ];

    const projectStage = {
      $project: {
        status: 1,
        role: 1,
        name: 1,
        email: 1,
      },
    };

    const sortStage = { $sort: { updatedAt: -1 } };

    let pipeline = [...paginationStage, projectStage];
    if (searchTerm && searchTerm.length > 0) {
      pipeline = [searchStage, ...paginationStage, projectStage];
    }

    let result = await User.aggregate(pipeline);
    result = result.map((res) => {
      return { ...res, _id: res._id.toString() };
    });
    return result;
  } catch (e) {
    throw new Error("Could not get users");
  }
};

export const fetchUserPages = async (searchTerm) => {
  try {
    const accountSearchStage = {
      $search: {
        index: "userSearchIndex", // The name of your full-text search index
        text: {
          query: searchTerm,
          path: {
            wildcard: "*",
          },
        },
      },
    };

    const countStage = {
      $count: "totalRecords", // This stage returns the total number of records matching the search query
    };

    let pipeline = [countStage];
    if (searchTerm && searchTerm.length > 0) {
      pipeline = [accountSearchStage, countStage];
    }
    const result = await User.aggregate(pipeline);
    let count = 1;
    if (result && result.length > 0) {
      count = result[0].totalRecords;
    }
    const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);
    console.log(result);

    return noOfPages;
  } catch (e) {
    throw new Error("Could not get accounts pages");
  }
};

//Customers queries
export const fetchAccountsPages = async (searchTerm) => {
  try {
    const accountSearchStage = {
      $search: {
        index: "accountSearchIndex", // The name of your full-text search index
        text: {
          query: searchTerm,
          path: {
            wildcard: "*",
          },
        },
      },
    };

    const countStage = {
      $count: "totalRecords", // This stage returns the total number of records matching the search query
    };

    let pipeline = [countStage];
    if (searchTerm && searchTerm.length > 0) {
      pipeline = [accountSearchStage, countStage];
    }
    const result = await Accounts.aggregate(pipeline);
    let count = 1;
    if (result && result.length > 0) {
      count = result[0].totalRecords;
    }
    const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);
    console.log(result);

    return noOfPages;
  } catch (e) {
    throw new Error("Could not get accounts pages");
  }
};

export const searchAccounts = async (searchTerm, page = 1) => {
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  try {
    const searchStage = {
      $search: {
        index: "accountSearchIndex", // Name of the full-text search index
        text: {
          query: searchTerm,
          path: {
            wildcard: "*",
          },
        },
      },
    };

    const paginationStage = [
      { $skip: skipRecords }, // Skip records for pagination
      { $limit: ITEMS_PER_PAGE }, // Limit results per page
    ];

    const projectStage = {
      $project: { name: 1, address: 1, phoneNumber: 1, email: 1 },
    };

    const sortStage = { $sort: { updatedAt: -1 } };

    let pipeline = [sortStage, ...paginationStage, projectStage];
    if (searchTerm && searchTerm.length > 0) {
      pipeline = [searchStage, ...paginationStage, projectStage];
    }

    let result = await Accounts.aggregate(pipeline);
    console.log(result);
    if (result && result.length > 0) {
      result = result.map((res) => {
        return { ...res, _id: res._id.toString() };
      });
    }

    return result;
  } catch (e) {
    throw new Error("Could not get accounts");
  }
};

//Products or stock queries

export const fetchStockPages = async (searchTerm) => {
  const transactionSearchStage = {
    $search: {
      index: "default", // The name of your full-text search index
      text: {
        query: searchTerm,
        path: {
          wildcard: "*",
        },
      },
    },
  };

  const countStage = {
    $count: "totalRecords", // This stage returns the total number of records matching the search query
  };

  let pipeline = [countStage];
  if (searchTerm && searchTerm.length > 0) {
    pipeline = [transactionSearchStage, countStage];
  }
  const result = await Product.aggregate(pipeline);
  let count = 1;
  if (result && result.length > 0) {
    count = result[0].totalRecords;
  }
  const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);
  console.log(result);

  return noOfPages;
};
export const searchStock = async (searchTerm, page = 1) => {
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  const searchStage = {
    $search: {
      index: "default", // Name of the atlas search index
      text: {
        query: searchTerm,
        path: {
          wildcard: "*",
        },
      },
    },
  };

  const paginationStage = [
    { $skip: skipRecords }, // Skip records for pagination
    { $limit: ITEMS_PER_PAGE }, // Limit results per page
  ];

  const sortStage = { $sort: { createdAt: -1 } };

  let pipeline = [sortStage, ...paginationStage];
  if (searchTerm && searchTerm.length > 0) {
    pipeline = [searchStage, ...paginationStage];
  }

  let result = await Product.aggregate(pipeline);
  result = result.map((res) => {
    return { ...res, _id: res._id.toString() };
  });
  return result;
};

export async function generateReport(
  startDate,
  endDate,
  vehicle,
  commodity,
  customer
) {
  try {
    // Step 1: Define the match filter based on the inputs
    const matchStage = {
      $match: {
        "firstWeight.date": {
          $gte: new Date(startDate), // Start date
          $lt: new Date(endDate), // End date
        },
        isComplete: true, // Ensure we only include completed transactions
      },
    };

    // Step 2: Add optional filters if provided
    if (vehicle) {
      matchStage.$match.vehRegNo = vehicle; // Filter by vehicle registration number if provided
    }

    if (commodity) {
      matchStage.$match.commodity = commodity; // Filter by commodity if provided
    }

    if (customer) {
      matchStage.$match["customer.name"] = customer; // Filter by customer name if provided
    }

    // Step 3: Define the report structure

    // Step 4: Run the aggregation pipeline
    const projectStage = {
      $project: {
        firstWeight: "$firstWeight.value",
        secondWeight: "$secondWeight.value",
        vehRegNo: 1,

        date: {
          $dateToString: {
            format: "%d-%m-%G %H:%M",
            date: "$firstWeight.date",
          },
        },

        customer: "$customer.name",
        commodity: 1,
        netWeight: {
          $abs: { $subtract: ["$firstWeight.value", "$secondWeight.value"] },
        },
      },
    };
    const limitStage = { $limit: 1000 };
    const pipeline = [matchStage, projectStage, limitStage];

    // Step 5: Return the report data
    let result = await Transactions.aggregate(pipeline);
    result = result.map((res) => {
      return { ...res, _id: res._id.toString().slice(0, 10) };
    });

    return result; // Return an empty object if no records found
  } catch (e) {
    throw new Error("An error occurred during report generation: " + e.message);
  }
}

export const getWbConfigs = async (id) => {
  noStore();
  const configs = await BridgeConfig.findOne({ weigherId: id });
  return configs;
};

//Invoices queries

export const filterInvoices = async (customer, startDate, endDate) => {
  try {
    if (isNaN(new Date(startDate)) || isNaN(new Date(endDate))) {
      throw new Error("Invalid start or end date");
    }
    const dateOne =
      format(startDate, "yyyy-MM-dd") + "T" + "00:00:00.000+00:00";
    const dateTwo = format(endDate, "yyyy-MM-dd") + "T" + "23:59:00.000+00:00";
    console.log(dateOne, dateTwo);

    const matchStage = {
      $match: {
        createdAt: { $gte: new Date(dateOne), $lte: new Date(dateTwo) },
      },
    };
    if (customer && customer !== "All") {
      matchStage.$match["customer.name"] = customer;
    }

    ("2024-11-11T18:55:16.755+00:00");

    const projectStage = {
      $project: {
        invoiceNumber: 1,
        date: {
          $dateToString: { format: "%d-%m-%G", date: "$createdAt" },
        },
        totalAmount: {
          $sum: {
            $map: {
              input: "$items",
              as: "item",
              in: { $multiply: ["$$item.unitPrice", "$$item.quantity"] },
            },
          },
        },
        customer: "$customer.name",
        status: 1,
      },
    };

    const sortStage = { $sort: { updatedAt: -1 } };

    const limitStage = { $limit: 2000 };

    const pipeline = [matchStage, sortStage, limitStage, projectStage];
    let result = await Invoice.aggregate(pipeline);

    if (result && result.length > 0) {
      result = result.map((res) => ({
        ...res,
        _id: res._id.toString(),
      }));
    }

    return result;
  } catch (e) {
    console.error("Error filtering invoices:", e);
    return { error: "Failed to fetch invoices." };
  }
};

export const searchInvoice = async (searchTerm, page = 1) => {
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  try {
    const searchStage = {
      $search: {
        index: "default", // Name of the full-text search index
        text: {
          query: searchTerm,
          path: {
            wildcard: "*",
          },
        },
      },
    };

    const paginationStage = [
      { $skip: skipRecords }, // Skip records for pagination
      { $limit: ITEMS_PER_PAGE }, // Limit results per page
    ];

    const projectStage = {
      $project: {
        invoiceNumber: 1,
        date: {
          $dateToString: { format: "%d-%m-%G", date: "$createdAt" },
        },

        totalAmount: {
          $sum: {
            $map: {
              input: "$items",
              as: "item",
              in: { $multiply: ["$$item.unitPrice", "$$item.quantity"] },
            },
          },
        },

        customer: "$customer.name",
        status: 1,
      },
    };

    const sortStage = { $sort: { updatedAt: -1 } };

    let pipeline = [sortStage, ...paginationStage, projectStage];
    if (searchTerm && searchTerm.length > 0) {
      pipeline = [searchStage, ...paginationStage, projectStage];
    }

    let result = await Invoice.aggregate(pipeline);

    if (result && result.length > 0) {
      result = result.map((res) => {
        return { ...res, _id: res._id.toString() };
      });
    }

    return result;
  } catch (e) {
    throw new Error("Could not get accounts");
  }
};

export const fetchLatestInvoices = async () => {
  const projectStage = {
    $project: {
      invoiceNumber: 1,

      totalAmount: {
        $sum: {
          $map: {
            input: "$items",
            as: "item",
            in: { $multiply: ["$$item.unitPrice", "$$item.quantity"] },
          },
        },
      },

      customer: "$customer.name",
    },
  };

  const limitStage = { $limit: 5 };

  const sortStage = { $sort: { createdAt: -1 } };
  const pipeline = [sortStage, limitStage, sortStage, projectStage];

  let result = await Invoice.aggregate(pipeline);
  if (result && result.length > 0) {
    result = result.map((res) => {
      return {
        _id: res._id.toString(),
        invoiceNumber: res.invoiceNumber,
        customer: res.customer,
        amount: res.totalAmount,
      };
    });
  }

  return result;
};

export const fetchInvoicePages = async (searchTerm) => {
  const transactionSearchStage = {
    $search: {
      index: "invoiceSearchIndex", // The name of your full-text search index
      text: {
        query: searchTerm,
        path: {
          wildcard: "*",
        },
      },
    },
  };

  const countStage = {
    $count: "totalRecords", // This stage returns the total number of records matching the search query
  };

  let pipeline = [countStage];
  if (searchTerm && searchTerm.length > 0) {
    pipeline = [transactionSearchStage, countStage];
  }
  const result = await Invoice.aggregate(pipeline);
  let count = 1;
  if (result && result.length > 0) {
    count = result[0].totalRecords;
  }
  const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);
  console.log(result);

  return noOfPages;
};

export const fetchStockTxPages = async (searchTerm) => {
  try {
    const accountSearchStage = {
      $search: {
        index: "stockTxSearchIndex", // The name of your full-text search index
        text: {
          query: searchTerm,
          path: {
            wildcard: "*",
          },
        },
      },
    };

    const countStage = {
      $count: "totalRecords", // This stage returns the total number of records matching the search query
    };

    let pipeline = [countStage];
    if (searchTerm && searchTerm.length > 0) {
      pipeline = [accountSearchStage, countStage];
    }
    const result = await StockTransaction.aggregate(pipeline);
    let count = 1;
    if (result && result.length > 0) {
      count = result[0].totalRecords;
    }
    const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);
    console.log(result);

    return noOfPages;
  } catch (e) {
    throw new Error("Could not get accounts pages");
  }
};

export const searchStockTx = async (searchTerm, page = 1) => {
  const skipRecords = (page - 1) * ITEMS_PER_PAGE;

  try {
    const searchStage = {
      $search: {
        index: "stockTxSearchIndex", // Name of the full-text search index
        text: {
          query: searchTerm,
          path: {
            wildcard: "*",
          },
        },
      },
    };

    const paginationStage = [
      { $skip: skipRecords }, // Skip records for pagination
      { $limit: ITEMS_PER_PAGE }, // Limit results per page
    ];

    const projectStage = {
      $project: {
        amount: 1,

        SKU: 1,
        transactionType: 1,
        date: {
          $dateToString: { format: "%d-%m-%G", date: "$date" },
        },
      },
    };

    const sortStage = { $sort: { date: -1 } };

    let pipeline = [sortStage, ...paginationStage, projectStage];
    if (searchTerm && searchTerm.length > 0) {
      pipeline = [searchStage, ...paginationStage, projectStage];
    }

    let result = await StockTransaction.aggregate(pipeline);

    if (result && result.length > 0) {
      result = result.map((res) => {
        return { ...res, _id: res._id.toString() };
      });
    }

    return result;
  } catch (e) {
    throw new Error("Could not get accounts");
  }
};

export const getStockAggregate = async () => {
  const matchStage = { $match: { stock: { $gt: 0 } } };
  const groupStage = {
    $group: {
      _id: null,
      totalCount: { $sum: "$stock" },
      totalValue: { $sum: { $multiply: ["$stock", "$price"] } },
    },
  };

  const result = await Product.aggregate([matchStage, groupStage]);

  const aggregates = result && result.length > 0 ? result[0] : null;
  return aggregates;
};

export const invoicesCount = async () => {
  const result = await Invoice.countDocuments();

  return result;
};

export const getTotalSaleThisMonth = async () => {
  // Define the start and end of the current month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const endOfMonth = new Date();
  endOfMonth.setMonth(endOfMonth.getMonth() + 1);
  endOfMonth.setDate(1);
  endOfMonth.setHours(0, 0, 0, 0);

  // Aggregation pipeline
  const result = await StockTransaction.aggregate([
    {
      // Match transactions from the current month
      $match: {
        date: {
          $gte: startOfMonth,
          $lt: endOfMonth,
        },
        transactionType: "Sale",
      },
    },
    {
      // Calculate the total sales for the current month
      $group: {
        _id: null,
        totalSales: {
          $sum: "$amount",
        },
      },
    },
  ]);

  let aggregates = 0;
  if (result && result.length > 0) {
    aggregates = result[0].totalSales;
  }

  return aggregates;
};

export const monthlySalesDistro = async () => {
  noStore();

  const now = new Date();
  const currentYear = now.getFullYear();

  // Determine if the current month is in the first or second half of the year
  const isFirstHalf = now.getMonth() < 6;

  // Set the start and end dates for the desired half-year range
  const startOfHalfYear = new Date(currentYear, isFirstHalf ? 0 : 6, 1); // January 1st or July 1st
  const endOfHalfYear = new Date(currentYear, isFirstHalf ? 6 : 12, 1); // July 1st or January 1st of the next year
  const matchStage = {
    $match: {
      date: {
        $gte: startOfHalfYear,
        $lt: endOfHalfYear,
      },
    },
  };

  const groupStage = {
    $group: {
      _id: {
        month: { $dateToString: { format: "%b", date: "$date" } },
        monthNum: {
          $dateToString: { format: "%m", date: "$date" },
        },
      },

      Sales: {
        $sum: {
          $cond: {
            if: { $eq: ["$transactionType", "Sale"] },
            then: "$amount",
            else: 0,
          },
        },
      },
      Purchases: {
        $sum: {
          $cond: {
            if: { $eq: ["$transactionType", "Purchase"] },
            then: "$amount",
            else: 0,
          },
        },
      },
    },
  };
  const projectStage = {
    $project: {
      _id: 1,
      Purchases: { $divide: ["$Purchases", 1000000] },
      Sales: { $divide: ["$Sales", 1000000] },
    },
  };
  const pipeline = [
    matchStage,
    groupStage,
    { $sort: { "_id.monthNum": 1 } },
    projectStage,
  ];

  const result = await StockTransaction.aggregate(pipeline);

  return result;
};

export const quartelySummary = async () => {
  noStore();

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Determine the start month of the current quarter
  const quarterStartMonth = Math.floor(currentMonth / 3) * 3;

  // Set the start and end dates for the desired quarter range
  const startOfQuarter = new Date(currentYear, quarterStartMonth, 1); // Start of current quarter
  const endOfQuarter = new Date(currentYear, quarterStartMonth + 3, 1); // Start of the next quarter

  const matchStage = {
    $match: {
      date: {
        $gte: startOfQuarter,
        $lt: endOfQuarter,
      },
    },
  };

  const groupStage = {
    $group: {
      _id: {
        month: { $dateToString: { format: "%b", date: "$date" } },
        monthNum: {
          $dateToString: { format: "%m", date: "$date" },
        },
      },
      Sales: {
        $sum: {
          $cond: {
            if: { $eq: ["$transactionType", "Sale"] },
            then: "$amount",
            else: 0,
          },
        },
      },
      Purchases: {
        $sum: {
          $cond: {
            if: { $eq: ["$transactionType", "Purchase"] },
            then: "$amount",
            else: 0,
          },
        },
      },
    },
  };
  const projectStage = {
    $project: {
      _id: 1,
      Purchases: { $divide: ["$Purchases", 1000000] },
      Sales: { $divide: ["$Sales", 1000] },
    },
  };

  const pipeline = [
    matchStage,
    groupStage,
    { $sort: { "_id.monthNum": 1 } },
    projectStage,
  ];

  const result = await StockTransaction.aggregate(pipeline);

  return result;
};

export async function getTopSellingProducts() {
  const groupStage = {
    $group: {
      _id: "$SKU",
      Sales: {
        $sum: {
          $cond: {
            if: { $eq: ["$transactionType", "Sale"] },
            then: "$amount",
            else: 0,
          },
        },
      },
      Purchases: {
        $sum: {
          $cond: {
            if: { $eq: ["$transactionType", "Purchase"] },
            then: "$amount",
            else: 0,
          },
        },
      },
    },
  };
  const projectStage = {
    $project: {
      _id: 1,
      Purchases: { $divide: ["$Purchases", 1000000] },
      Sales: { $divide: ["$Sales", 1000000] },
    },
  };
  const sortStage = { $sort: { Sales: -1 } };
  const limitStage = { $limit: 10 };
  const pipeline = [groupStage, sortStage, limitStage, projectStage];
  const result = await StockTransaction.aggregate(pipeline);

  return result;
}

export const quarterlySalesDistro = async () => {
  noStore();

  const now = new Date();
  const currentYear = now.getFullYear();

  // Set the start and end dates for the current year
  const startOfYear = new Date(currentYear, 0, 1); // January 1st
  const endOfYear = new Date(currentYear + 1, 0, 1); // January 1st of the next year

  const matchStage = {
    $match: {
      date: {
        $gte: startOfYear,
        $lt: endOfYear,
      },
    },
  };

  const groupStage = {
    $group: {
      _id: {
        quarter: {
          $add: [{ $divide: [{ $month: "$date" }, 3] }, 1],
        },
        year: { $year: "$date" },
      },
      Sales: {
        $sum: {
          $cond: {
            if: { $eq: ["$transactionType", "Sale"] },
            then: "$amount",
            else: 0,
          },
        },
      },
      Purchases: {
        $sum: {
          $cond: {
            if: { $eq: ["$transactionType", "Purchase"] },
            then: "$amount",
            else: 0,
          },
        },
      },
    },
  };

  const projectStage = {
    $project: {
      _id: 1,
      Purchases: { $divide: ["$Purchases", 1000000] }, // Convert to millions
      Sales: { $divide: ["$Sales", 1000000] }, // Convert to millions
    },
  };

  const pipeline = [
    matchStage,
    groupStage,
    { $sort: { "_id.year": 1, "_id.quarter": 1 } },
    projectStage,
  ];

  const result = await StockTransaction.aggregate(pipeline);

  return result;
};

import { StockRequest } from "../../models/requests";
import { ItemCheckout } from "../../models/checkouts";
import dbConnect from "../../config/dbConnect";

// ============================================
// TECHNICIAN DASHBOARD STATS
// ============================================
export const getTechnicianStats = async (userId) => {
  await dbConnect();
  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const [
    totalRequests,
    pendingRequests,
    approvedRequests,
    borrowedItems,
    overdueItems,
    dueSoonItems,
  ] = await Promise.all([
    // Total requests by this user
    StockRequest.countDocuments({ "requester.id": userId }),

    // Pending requests
    StockRequest.countDocuments({
      "requester.id": userId,
      status: "pending",
    }),

    // Approved requests
    StockRequest.countDocuments({
      "requester.id": userId,
      status: "approved",
    }),

    // Currently borrowed items
    ItemCheckout.countDocuments({
      "checkedOutTo.id": userId,
      status: "checked_out",
    }),

    // Overdue items
    ItemCheckout.countDocuments({
      "checkedOutTo.id": userId,
      status: "checked_out",
      expectedReturnDate: { $lt: now },
    }),

    // Due soon (next 3 days)
    ItemCheckout.countDocuments({
      "checkedOutTo.id": userId,
      status: "checked_out",
      expectedReturnDate: { $gte: now, $lte: threeDaysFromNow },
    }),
  ]);

  return {
    totalRequests,
    pendingRequests,
    approvedRequests,
    borrowedItems,
    overdueItems,
    dueSoonItems,
  };
};

// ============================================
// MY BORROWED ITEMS
// ============================================
export const getMyBorrowedItems = async (userId) => {
  await dbConnect();
  const now = new Date();

  const items = await ItemCheckout.find({
    "checkedOutTo.id": userId,
    status: "checked_out",
  })
    .sort({ expectedReturnDate: 1 })
    .limit(20)
    .lean();

  return items.map((item) => {
    const dueDate = new Date(item.expectedReturnDate);
    const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

    let urgency = "safe"; // green
    if (daysUntilDue < 0) {
      urgency = "overdue"; // red
    } else if (daysUntilDue <= 3) {
      urgency = "soon"; // orange
    }

    return {
      _id: item._id.toString(),
      checkoutNumber: item.checkoutNumber,
      productSnapshot: item.productSnapshot,
      checkedOutDate: item.checkedOutDate?.toISOString(),
      expectedReturnDate: item.expectedReturnDate?.toISOString(),
      daysUntilDue,
      urgency,
      purpose: item.purpose,
      serialNo: item.serialNo,
    };
  });
};

// ============================================
// MY OVERDUE ITEMS
// ============================================
export const getMyOverdueItems = async (userId) => {
  await dbConnect();
  const now = new Date();

  const items = await ItemCheckout.find({
    "checkedOutTo.id": userId,
    status: "checked_out",
    expectedReturnDate: { $lt: now },
  })
    .sort({ expectedReturnDate: 1 })
    .lean();

  return items.map((item) => {
    const dueDate = new Date(item.expectedReturnDate);
    const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));

    return {
      _id: item._id.toString(),
      checkoutNumber: item.checkoutNumber,
      productSnapshot: item.productSnapshot,
      expectedReturnDate: item.expectedReturnDate.toISOString(),
      daysOverdue,
      purpose: item.purpose,
      serialNo: item.serialNo,
    };
  });
};

// ============================================
// MY REQUESTS
// ============================================
export const getMyRequests = async (userId, limit = 10) => {
  await dbConnect();
  const requests = await StockRequest.find({ "requester.id": userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return requests.map((request) => ({
    _id: request._id.toString(),
    requestNumber: request.requestNumber,
    status: request.status,
    priority: request.priority,
    itemCount: request.items?.length || 0,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt?.toISOString(),
    requestType: request.requestType,
    approvedBy: request.approvedBy,
  }));
};

// ============================================
// MY RECENT ACTIVITY
// ============================================
export const getMyRecentActivity = async (userId, limit = 10) => {
  await dbConnect();
  // Get recent checkouts
  const checkouts = await ItemCheckout.find({
    "checkedOutTo.id": userId,
  })
    .sort({ checkedOutDate: -1 })
    .limit(limit)
    .lean();

  // Get recent requests
  const requests = await StockRequest.find({
    "requester.id": userId,
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // Combine and sort by date
  const activities = [];

  checkouts.forEach((checkout) => {
    activities.push({
      type: checkout.status === "checked_out" ? "borrowed" : "returned",
      date: checkout?.checkedOutDate?.toISOString(),
      item: checkout.productSnapshot.name,
      checkoutNumber: checkout.checkoutNumber,
      status: checkout.status,
    });

    if (checkout.returnDate) {
      activities.push({
        type: "returned",
        date: checkout.returnDate.toISOString(),
        item: checkout.productSnapshot.name,
        checkoutNumber: checkout.checkoutNumber,
        condition: checkout.returnCondition,
      });
    }
  });

  requests.forEach((request) => {
    activities.push({
      type: "request_created",
      date: request.createdAt.toISOString(),
      requestNumber: request.requestNumber,
      status: request.status,
      itemCount: request.items?.length || 0,
    });

    if (request.approvedBy) {
      activities.push({
        type: "request_approved",
        date:
          request.updatedAt?.toISOString() || request.createdAt.toISOString(),
        requestNumber: request.requestNumber,
        approvedBy: request.approvedBy.name,
      });
    }
  });

  // Sort by date (newest first)
  activities.sort((a, b) => new Date(b.date) - new Date(a.date));

  return activities.slice(0, limit);
};

// ============================================
// MASTER TECHNICIAN DASHBOARD DATA
// ============================================
export const getTechnicianDashboardData = async (userId) => {
  const [recentActivity] = await Promise.all([
    getMyRequests(userId, 10),
    getMyRecentActivity(userId, 10),
  ]);

  return {
    recentActivity,
  };
};

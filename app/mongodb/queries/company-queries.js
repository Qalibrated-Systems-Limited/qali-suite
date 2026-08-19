import dbConnect from "../../config/dbConnect";
import Company from "../../models/Company";
import { unstable_noStore as noStore } from "next/cache";

/**
 * PLATFORM METRICS ONLY — the company record itself has moved (0035).
 *
 * Everything that read one company (its record, its settings, its
 * subscription, the admin list, the letterhead) now reads Postgres through
 * app/db/platform.ts. What is left here are the SuperAdmin dashboard's
 * cross-store aggregations: they join companies to Mongo users, invoices and
 * payments, so they cannot move until those do.
 *
 * They still read `subscription` and `status` off the Mongo document, which is
 * why lib/subscription-helpers.js mirrors those back after writing Postgres.
 * That mirror exists for these functions and should be deleted with them.
 */

// ============================================
export const getPlatformMetrics = async () => {
  noStore();
  await dbConnect();

  // Import User model dynamically to avoid circular dependencies
  const User = (await import("../../models/user")).default;

  const now = new Date();
  const todayStart = new Date(now.setHours(0, 0, 0, 0));
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  const [
    companyStats,
    totalUsers,
    activeUsersToday,
    trialsExpiringSoon,
    subscriptionsExpiringSoon,
  ] = await Promise.all([
    // Company stats by status
    Company.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          inactive: {
            $sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] },
          },
          suspended: {
            $sum: { $cond: [{ $eq: ["$status", "suspended"] }, 1, 0] },
          },
          trial: {
            $sum: { $cond: [{ $eq: ["$subscription.status", "trial"] }, 1, 0] },
          },
        },
      },
    ]),

    // Total users across all companies
    User.countDocuments(),

    // Active users today (users who logged in today - if lastLoginAt field exists)
    User.countDocuments({
      updatedAt: { $gte: todayStart },
      status: "Active",
    }),

    // Trials expiring within 7 days
    Company.countDocuments({
      "subscription.status": "trial",
      "subscription.trialEndsAt": {
        $gte: new Date(),
        $lte: sevenDaysFromNow,
      },
    }),

    // Subscriptions expiring within 30 days
    Company.countDocuments({
      "subscription.status": "active",
      "subscription.currentPeriodEnd": {
        $gte: new Date(),
        $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    }),
  ]);

  const stats = companyStats[0] || {
    total: 0,
    active: 0,
    inactive: 0,
    suspended: 0,
    trial: 0,
  };

  return {
    companies: {
      total: stats.total,
      active: stats.active,
      trial: stats.trial,
      suspended: stats.suspended,
    },
    users: {
      total: totalUsers,
      activeToday: activeUsersToday,
    },
    alerts: {
      trialsExpiring: trialsExpiringSoon,
      subscriptionsExpiring: subscriptionsExpiringSoon,
      critical: stats.suspended,
    },
  };
};

/**
 * Get subscription distribution for donut chart
 */
export const getSubscriptionDistribution = async () => {
  noStore();
  await dbConnect();

  const distribution = await Company.aggregate([
    {
      $group: {
        _id: "$subscription.plan",
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
  ]);

  const planColors = {
    enterprise: "#8b5cf6", // Violet
    professional: "#3b82f6", // Blue
    starter: "#f59e0b", // Amber
    free: "#6b7280", // Gray
  };

  const total = distribution.reduce((sum, item) => sum + item.count, 0);

  return distribution.map((item) => ({
    name: item._id || "free",
    value: item.count,
    percentage: total > 0 ? Math.round((item.count / total) * 100) : 0,
    color: planColors[item._id] || "#6b7280",
  }));
};

/**
 * Get companies with upcoming trial/subscription expiry
 */
export const getExpiringCompanies = async () => {
  noStore();
  await dbConnect();

  const now = new Date();
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const [trialsExpiring, subscriptionsExpiring] = await Promise.all([
    // Trials expiring within 7 days
    Company.find({
      "subscription.status": "trial",
      "subscription.trialEndsAt": {
        $gte: now,
        $lte: sevenDaysFromNow,
      },
    })
      .select("name slug subscription.trialEndsAt")
      .sort({ "subscription.trialEndsAt": 1 })
      .limit(5)
      .lean(),

    // Subscriptions expiring within 30 days
    Company.find({
      "subscription.status": "active",
      "subscription.currentPeriodEnd": {
        $gte: now,
        $lte: thirtyDaysFromNow,
      },
    })
      .select("name slug subscription.plan subscription.currentPeriodEnd")
      .sort({ "subscription.currentPeriodEnd": 1 })
      .limit(5)
      .lean(),
  ]);

  const formatDaysRemaining = (date) => {
    const diff = Math.ceil((new Date(date) - now) / (1000 * 60 * 60 * 24));
    return diff;
  };

  return {
    trials: trialsExpiring.map((c) => ({
      _id: c._id.toString(),
      name: c.name,
      slug: c.slug,
      daysRemaining: formatDaysRemaining(c.subscription.trialEndsAt),
    })),
    subscriptions: subscriptionsExpiring.map((c) => ({
      _id: c._id.toString(),
      name: c.name,
      slug: c.slug,
      plan: c.subscription.plan,
      daysRemaining: formatDaysRemaining(c.subscription.currentPeriodEnd),
    })),
  };
};

/**
 * Get company health overview for table
 * Health is calculated based on user activity and status
 */
export const getCompanyHealthOverview = async (limit = 10) => {
  noStore();
  await dbConnect();

  const User = (await import("../../models/user")).default;

  // Get companies with basic info
  const companies = await Company.find()
    .select("name slug status subscription")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // Get user counts per company
  const userCounts = await User.aggregate([
    {
      $group: {
        _id: "$companyId",
        userCount: { $sum: 1 },
      },
    },
  ]);

  const userCountMap = {};
  userCounts.forEach((item) => {
    if (item._id) {
      userCountMap[item._id.toString()] = item.userCount;
    }
  });

  // Calculate health score (0-5 scale)
  const calculateHealth = (company, userCount) => {
    let score = 0;

    // Status contribution (max 2 points)
    if (company.status === "active") score += 2;
    else if (company.status === "inactive") score += 1;

    // Subscription status (max 2 points)
    if (company.subscription?.status === "active") score += 2;
    else if (company.subscription?.status === "trial") score += 1;

    // User activity (max 1 point)
    if (userCount > 0) score += 1;

    return score;
  };

  return companies.map((company) => {
    const userCount = userCountMap[company._id.toString()] || 0;
    const health = calculateHealth(company, userCount);

    return {
      _id: company._id.toString(),
      name: company.name,
      slug: company.slug,
      status: company.status,
      subscriptionStatus: company.subscription?.status || "none",
      plan: company.subscription?.plan || "free",
      userCount,
      health,
    };
  });
};

/**
 * Get recent platform activity (new companies, users, etc.)
 */
export const getRecentPlatformActivity = async (limit = 10) => {
  noStore();
  await dbConnect();

  const User = (await import("../../models/user")).default;

  // Get recent companies and users
  const [recentCompanies, recentUsers] = await Promise.all([
    Company.find()
      .select("name slug createdAt")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),

    User.find()
      .select("name email companyId createdAt role")
      .populate("companyId", "name")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);

  // Combine and sort by date
  const activities = [
    ...recentCompanies.map((c) => ({
      type: "company_created",
      message: `New company "${c.name}" registered`,
      timestamp: c.createdAt,
      link: `/dashboard/admin/companies/${c.slug}`,
    })),
    ...recentUsers.map((u) => ({
      type: "user_created",
      message: `New user "${u.name}" added${u.companyId?.name ? ` to ${u.companyId.name}` : ""}`,
      timestamp: u.createdAt,
      link: null,
    })),
  ];

  // Sort by timestamp descending
  activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Format relative time
  const formatRelativeTime = (date) => {
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return "Yesterday";
    return `${days}d ago`;
  };

  return activities.slice(0, limit).map((activity) => ({
    ...activity,
    relativeTime: formatRelativeTime(activity.timestamp),
    timestamp: activity.timestamp.toISOString(),
  }));
};

/**
 * Get Monthly Recurring Revenue (MRR) for SuperAdmin dashboard
 */
export const getMRRMetrics = async () => {
  noStore();
  await dbConnect();

  // Define pricing per plan (adjust based on your actual pricing)
  const planPricing = {
    enterprise: 50000, // KES per month
    professional: 25000,
    starter: 10000,
    free: 0,
  };

  const now = new Date();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Get current active subscriptions grouped by plan
  const currentMRR = await Company.aggregate([
    {
      $match: {
        status: "active",
        "subscription.status": { $in: ["active", "trialing"] },
      },
    },
    {
      $group: {
        _id: "$subscription.plan",
        count: { $sum: 1 },
      },
    },
  ]);

  // Calculate current MRR
  let totalMRR = 0;
  currentMRR.forEach((item) => {
    const price = planPricing[item._id] || 0;
    totalMRR += price * item.count;
  });

  // Get last month's company count for trend calculation
  const lastMonthCompanies = await Company.countDocuments({
    status: "active",
    "subscription.status": { $in: ["active", "trialing"] },
    createdAt: { $lt: thisMonthStart },
  });

  const currentCompanies = await Company.countDocuments({
    status: "active",
    "subscription.status": { $in: ["active", "trialing"] },
  });

  // Calculate trend (simplified - based on company growth)
  const trend =
    lastMonthCompanies > 0
      ? Math.round(
          ((currentCompanies - lastMonthCompanies) / lastMonthCompanies) * 100
        )
      : 0;

  return {
    current: totalMRR,
    trend: trend,
    breakdown: currentMRR.map((item) => ({
      plan: item._id || "free",
      count: item.count,
      revenue: (planPricing[item._id] || 0) * item.count,
    })),
  };
};

/**
 * Get platform activity data for stacked area chart (last 30 days)
 * Shows: New Users, Active Sessions (approximated by logins), Transactions
 */
export const getPlatformActivityChart = async () => {
  noStore();
  await dbConnect();

  const User = (await import("../../models/user")).default;

  // Try to import JournalEntry for transactions, fallback gracefully
  let JournalEntry;
  try {
    JournalEntry = (await import("../../models/JournalEntry")).default;
  } catch (e) {
    JournalEntry = null;
  }

  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Generate date labels for last 30 days
  const dates = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    dates.push(date);
  }

  // Get new users per day
  const newUsersByDay = await User.aggregate([
    {
      $match: {
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  // Get active users per day (approximated by updatedAt as proxy for activity)
  const activeUsersByDay = await User.aggregate([
    {
      $match: {
        updatedAt: { $gte: thirtyDaysAgo },
        status: "Active",
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  // Get transactions per day (if JournalEntry exists)
  let transactionsByDay = [];
  if (JournalEntry) {
    try {
      transactionsByDay = await JournalEntry.aggregate([
        {
          $match: {
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
      ]);
    } catch (e) {
      // Ignore errors, just use empty array
    }
  }

  // Convert to maps for easy lookup
  const newUsersMap = {};
  newUsersByDay.forEach((item) => {
    newUsersMap[item._id] = item.count;
  });

  const activeUsersMap = {};
  activeUsersByDay.forEach((item) => {
    activeUsersMap[item._id] = item.count;
  });

  const transactionsMap = {};
  transactionsByDay.forEach((item) => {
    transactionsMap[item._id] = item.count;
  });

  // Build chart data
  const chartData = dates.map((date) => {
    const dateStr = date.toISOString().split("T")[0];
    return {
      date: dateStr,
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      newUsers: newUsersMap[dateStr] || 0,
      activeSessions: activeUsersMap[dateStr] || 0,
      transactions: transactionsMap[dateStr] || 0,
    };
  });

  return chartData;
};

/**
 * Get company health overview with revenue data for table
 */
export const getCompanyHealthWithRevenue = async (limit = 10) => {
  noStore();
  await dbConnect();

  const User = (await import("../../models/user")).default;

  // Try to import JournalEntry for revenue calculation
  let JournalEntry;
  try {
    JournalEntry = (await import("../../models/JournalEntry")).default;
  } catch (e) {
    JournalEntry = null;
  }

  // Get companies with basic info
  const companies = await Company.find()
    .select("name slug status subscription")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // Get user counts per company
  const userCounts = await User.aggregate([
    {
      $group: {
        _id: "$companyId",
        userCount: { $sum: 1 },
      },
    },
  ]);

  const userCountMap = {};
  userCounts.forEach((item) => {
    if (item._id) {
      userCountMap[item._id.toString()] = item.userCount;
    }
  });

  // Get revenue per company (if JournalEntry exists)
  let revenueMap = {};
  if (JournalEntry) {
    try {
      const revenueByCompany = await JournalEntry.aggregate([
        {
          $match: {
            accountType: "revenue",
          },
        },
        {
          $group: {
            _id: "$companyId",
            totalRevenue: {
              $sum: { $subtract: ["$credit", "$debit"] },
            },
          },
        },
      ]);

      revenueByCompany.forEach((item) => {
        if (item._id) {
          revenueMap[item._id.toString()] = item.totalRevenue;
        }
      });
    } catch (e) {
      // Ignore errors
    }
  }

  // Calculate health score (0-5 scale)
  const calculateHealth = (company, userCount, revenue) => {
    let score = 0;

    // Status contribution (max 2 points)
    if (company.status === "active") score += 2;
    else if (company.status === "inactive") score += 1;

    // Subscription status (max 1 point)
    if (company.subscription?.status === "active") score += 1;
    else if (company.subscription?.status === "trial") score += 0.5;

    // User activity (max 1 point)
    if (userCount > 5) score += 1;
    else if (userCount > 0) score += 0.5;

    // Revenue activity (max 1 point)
    if (revenue > 100000) score += 1;
    else if (revenue > 0) score += 0.5;

    return Math.min(5, Math.round(score));
  };

  return companies.map((company) => {
    const userCount = userCountMap[company._id.toString()] || 0;
    const revenue = revenueMap[company._id.toString()] || 0;
    const health = calculateHealth(company, userCount, revenue);

    return {
      _id: company._id.toString(),
      name: company.name,
      slug: company.slug,
      status: company.status,
      subscriptionStatus: company.subscription?.status || "none",
      plan: company.subscription?.plan || "free",
      userCount,
      revenue,
      health,
    };
  });
};

/**
 * Get system alerts for SuperAdmin
 */
export const getSystemAlerts = async () => {
  noStore();
  await dbConnect();

  const User = (await import("../../models/user")).default;

  const now = new Date();
  const threeDaysFromNow = new Date();
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

  const [
    suspendedCompanies,
    trialsExpiringIn3Days,
    companiesAtUserLimit,
  ] = await Promise.all([
    // Suspended companies
    Company.countDocuments({ status: "suspended" }),

    // Trials expiring in 3 days
    Company.countDocuments({
      "subscription.status": "trial",
      "subscription.trialEndsAt": {
        $gte: now,
        $lte: threeDaysFromNow,
      },
    }),

    // Companies at or near user limit
    Company.aggregate([
      {
        $match: {
          status: "active",
          "subscription.maxUsers": { $exists: true, $gt: 0 },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "companyId",
          as: "users",
        },
      },
      {
        $project: {
          name: 1,
          maxUsers: "$subscription.maxUsers",
          currentUsers: { $size: "$users" },
        },
      },
      {
        $match: {
          $expr: { $gte: ["$currentUsers", "$maxUsers"] },
        },
      },
      {
        $count: "count",
      },
    ]),
  ]);

  const alerts = [];

  if (suspendedCompanies > 0) {
    alerts.push({
      type: "critical",
      icon: "🔴",
      message: `${suspendedCompanies} ${suspendedCompanies === 1 ? "company" : "companies"} suspended`,
      count: suspendedCompanies,
    });
  }

  if (trialsExpiringIn3Days > 0) {
    alerts.push({
      type: "warning",
      icon: "🟡",
      message: `${trialsExpiringIn3Days} ${trialsExpiringIn3Days === 1 ? "trial" : "trials"} expiring within 3 days`,
      count: trialsExpiringIn3Days,
    });
  }

  const atLimitCount = companiesAtUserLimit[0]?.count || 0;
  if (atLimitCount > 0) {
    alerts.push({
      type: "warning",
      icon: "🟡",
      message: `${atLimitCount} ${atLimitCount === 1 ? "company" : "companies"} at user limit`,
      count: atLimitCount,
    });
  }

  return alerts;
};

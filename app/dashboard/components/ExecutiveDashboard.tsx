import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

// Components
import {
  MetricCard,
  MetricCardsGrid,
  MetricCardsGridSkeleton,
} from "./MetricsCard";
import {
  ChartCard,
  ChartCardSkeleton,
} from "./ChartCard";
import {
  ActivityCard,
  ActivityItem,
  EmptyState,
  ActivityCardSkeleton,
} from "./ActivityCard";

// Models
import Invoice from "../../models/invoice";
import Bill from "../../models/bill";
import JournalEntry from "../../models/JournalEntry";
import Account from "../../models/account";
import dbConnect from "../../config/dbConnect";

// Utils
import { formatCurrency } from "@/lib/utils";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;

// ============================================
// EXECUTIVE DASHBOARD PAGE
// High-level view for executives and owners
// ============================================
export default async function ExecutiveDashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;
  const userRole = (user as { role?: string }).role || "Employee";

  // Only executives and admins
  if (!["Admin", "SuperAdmin"].includes(userRole)) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
          Executive Summary
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          High-level financial overview
        </p>
      </div>

      {/* Key Financial Metrics */}
      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Financial Health
        </h2>
        <Suspense fallback={<MetricCardsGridSkeleton count={4} />}>
          <KeyMetricsCards />
        </Suspense>
      </section>

      {/* Revenue & Cash Position */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Suspense fallback={<ChartCardSkeleton />}>
          <RevenueTrendCard />
        </Suspense>
        <Suspense fallback={<ChartCardSkeleton />}>
          <CashPositionCard />
        </Suspense>
      </section>

      {/* Financial Ratios & Top Customers */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Suspense fallback={<ChartCardSkeleton />}>
          <FinancialRatiosCard />
        </Suspense>
        <Suspense fallback={<ActivityCardSkeleton />}>
          <TopCustomersCard />
        </Suspense>
      </section>
    </div>
  );
}

// ============================================
// KEY METRICS CARDS
// ============================================
async function KeyMetricsCards() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  // Get current month revenue (from completed invoices)
  const [currentMonthInvoices, lastMonthInvoices, totalAR, totalAP] = await Promise.all([
    Invoice.aggregate([
      {
        $match: {
          ...tenantMatch,
          status: "completed",
          invoiceDate: { $gte: startOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
          count: { $sum: 1 },
        },
      },
    ]),
    Invoice.aggregate([
      {
        $match: {
          ...tenantMatch,
          status: "completed",
          invoiceDate: { $gte: startOfLastMonth, $lte: endOfLastMonth },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
        },
      },
    ]),
    Invoice.aggregate([
      {
        $match: {
          ...tenantMatch,
          status: "completed",
          paymentStatus: { $in: ["unpaid", "partial"] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amountDue" },
        },
      },
    ]),
    Bill.aggregate([
      {
        $match: {
          ...tenantMatch,
          status: "approved",
          paymentStatus: { $in: ["unpaid", "partial"] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amounts.balance" },
        },
      },
    ]),
  ]);

  const currentRevenue = currentMonthInvoices[0]?.total || 0;
  const lastRevenue = lastMonthInvoices[0]?.total || 0;
  const revenueChange = lastRevenue > 0
    ? Math.round(((currentRevenue - lastRevenue) / lastRevenue) * 100)
    : 0;

  const arTotal = totalAR[0]?.total || 0;
  const apTotal = totalAP[0]?.total || 0;
  const netPosition = arTotal - apTotal;

  return (
    <MetricCardsGrid cols={4}>
      <MetricCard
        title="MTD Revenue"
        value={formatCurrency(currentRevenue)}
        subtitle={revenueChange >= 0 ? `+${revenueChange}% vs last month` : `${revenueChange}% vs last month`}
        icon="TrendingUp"
        iconColor={revenueChange >= 0 ? "text-green-500" : "text-red-500"}
      />
      <MetricCard
        title="Accounts Receivable"
        value={formatCurrency(arTotal)}
        subtitle="Outstanding"
        icon="ArrowDownCircle"
        iconColor="text-blue-500"
        href="/dashboard/reports/ar-aging"
      />
      <MetricCard
        title="Accounts Payable"
        value={formatCurrency(apTotal)}
        subtitle="Outstanding"
        icon="ArrowUpCircle"
        iconColor="text-orange-500"
        href="/dashboard/reports/ap-aging"
      />
      <MetricCard
        title="Net Position"
        value={formatCurrency(netPosition)}
        subtitle="AR - AP"
        icon="Scale"
        iconColor={netPosition >= 0 ? "text-green-500" : "text-red-500"}
      />
    </MetricCardsGrid>
  );
}

// ============================================
// REVENUE TREND CARD (Last 6 Months)
// ============================================
async function RevenueTrendCard() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  // Get last 6 months of revenue
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const monthlyRevenue = await Invoice.aggregate([
    {
      $match: {
        ...tenantMatch,
        status: "completed",
        invoiceDate: { $gte: sixMonthsAgo },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$invoiceDate" },
          month: { $month: "$invoiceDate" },
        },
        revenue: { $sum: "$total" },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);

  // Build months array for last 6 months
  const months: Array<{ label: string; revenue: number; count: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const label = date.toLocaleDateString("en-US", { month: "short" });

    const found = monthlyRevenue.find(
      (m: any) => m._id.year === year && m._id.month === month
    );

    months.push({
      label,
      revenue: found?.revenue || 0,
      count: found?.count || 0,
    });
  }

  const maxRevenue = Math.max(...months.map((m) => m.revenue), 1);
  const totalRevenue = months.reduce((sum, m) => sum + m.revenue, 0);
  const avgRevenue = totalRevenue / 6;

  return (
    <ChartCard
      title="Revenue Trend"
      subtitle={`${formatCurrency(totalRevenue)} total (6 months)`}
    >
      <div className="pt-4">
        {/* Bar Chart */}
        <div className="flex items-end justify-between gap-2 h-32 mb-2">
          {months.map((month, index) => (
            <div key={index} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex flex-col items-center">
                <span className="text-[10px] text-muted-foreground mb-1">
                  {formatCurrency(month.revenue, true)}
                </span>
                <div
                  className={`w-full rounded-t transition-all ${
                    month.revenue >= avgRevenue ? "bg-green-500" : "bg-blue-500"
                  }`}
                  style={{
                    height: `${Math.max((month.revenue / maxRevenue) * 80, 4)}px`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        {/* X-axis labels */}
        <div className="flex justify-between">
          {months.map((month, index) => (
            <span
              key={index}
              className="flex-1 text-center text-xs text-muted-foreground"
            >
              {month.label}
            </span>
          ))}
        </div>
        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-muted-foreground">Above average</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Below average</span>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

// ============================================
// CASH POSITION CARD
// ============================================
async function CashPositionCard() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  // Get cash and bank accounts with balances
  const cashAccounts = await Account.find({
    ...tenantMatch,
    subType: { $in: ["cash", "bank", "mpesa"] },
    isActive: true,
  }).lean();

  // Get balances from posted journal entries
  const accountIds = cashAccounts.map((a) => a._id);

  const balances = await JournalEntry.aggregate([
    {
      $match: {
        ...tenantMatch,
        status: "posted",
      },
    },
    { $unwind: "$lines" },
    {
      $match: {
        "lines.accountId": { $in: accountIds },
      },
    },
    {
      $group: {
        _id: "$lines.accountId",
        balance: { $sum: { $subtract: ["$lines.debit", "$lines.credit"] } },
      },
    },
  ]);

  const balanceMap = balances.reduce((acc: Record<string, number>, b: any) => {
    acc[b._id.toString()] = b.balance;
    return acc;
  }, {});

  const accountsWithBalances = cashAccounts.map((a: any) => ({
    id: a._id.toString(),
    name: a.accountName,
    code: a.accountCode,
    type: a.subType,
    balance: balanceMap[a._id.toString()] || 0,
  }));

  const totalCash = accountsWithBalances.reduce((sum, a) => sum + a.balance, 0);

  // Sort by balance descending
  accountsWithBalances.sort((a, b) => b.balance - a.balance);

  return (
    <ChartCard
      title="Cash Position"
      subtitle={`${formatCurrency(totalCash)} total available`}
    >
      {accountsWithBalances.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">No cash accounts configured</p>
        </div>
      ) : (
        <div className="space-y-3 pt-2">
          {accountsWithBalances.slice(0, 5).map((account) => (
            <div key={account.id} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      account.type === "bank"
                        ? "bg-blue-500"
                        : account.type === "mpesa"
                        ? "bg-green-500"
                        : "bg-yellow-500"
                    }`}
                  />
                  <span className="text-muted-foreground">{account.name}</span>
                </div>
                <span
                  className={`font-medium tabular-nums ${
                    account.balance >= 0 ? "text-foreground" : "text-red-500"
                  }`}
                >
                  {formatCurrency(account.balance)}
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    account.type === "bank"
                      ? "bg-blue-500"
                      : account.type === "mpesa"
                      ? "bg-green-500"
                      : "bg-yellow-500"
                  }`}
                  style={{
                    width: `${Math.max((account.balance / totalCash) * 100, 2)}%`,
                  }}
                />
              </div>
            </div>
          ))}
          {/* Legend */}
          <div className="flex items-center justify-center gap-4 pt-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <span className="text-muted-foreground">Bank</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-muted-foreground">M-Pesa</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-yellow-500" />
              <span className="text-muted-foreground">Cash</span>
            </div>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

// ============================================
// FINANCIAL RATIOS CARD
// ============================================
async function FinancialRatiosCard() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  // Get YTD revenue and expenses from journal entries
  const [revenueAccounts, expenseAccounts, cogsAccounts] = await Promise.all([
    Account.find({ ...tenantMatch, accountType: "Revenue", isActive: true }),
    Account.find({ ...tenantMatch, accountType: "Expense", isActive: true }),
    Account.find({ ...tenantMatch, systemAccount: "cogs" }),
  ]);

  const revenueIds = revenueAccounts.map((a) => a._id);
  const expenseIds = expenseAccounts.map((a) => a._id);
  const cogsIds = cogsAccounts.map((a) => a._id);

  const ytdTotals = await JournalEntry.aggregate([
    {
      $match: {
        ...tenantMatch,
        status: "posted",
        entryDate: { $gte: startOfYear },
      },
    },
    { $unwind: "$lines" },
    {
      $group: {
        _id: null,
        revenue: {
          $sum: {
            $cond: [
              { $in: ["$lines.accountId", revenueIds] },
              { $subtract: ["$lines.credit", "$lines.debit"] },
              0,
            ],
          },
        },
        cogs: {
          $sum: {
            $cond: [
              { $in: ["$lines.accountId", cogsIds] },
              { $subtract: ["$lines.debit", "$lines.credit"] },
              0,
            ],
          },
        },
        expenses: {
          $sum: {
            $cond: [
              { $in: ["$lines.accountId", expenseIds] },
              { $subtract: ["$lines.debit", "$lines.credit"] },
              0,
            ],
          },
        },
      },
    },
  ]);

  const revenue = ytdTotals[0]?.revenue || 0;
  const cogs = ytdTotals[0]?.cogs || 0;
  const expenses = ytdTotals[0]?.expenses || 0;

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - expenses;

  const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  // Get current assets and liabilities for current ratio
  const [currentAssets, currentLiabilities] = await Promise.all([
    Account.find({
      ...tenantMatch,
      accountType: "Asset",
      subType: { $in: ["cash", "bank", "mpesa", "receivable", "inventory", "prepaid", "tax"] },
      isActive: true,
    }),
    Account.find({
      ...tenantMatch,
      accountType: "Liability",
      subType: { $in: ["payable", "tax", "payroll", "accrual", "deferred", "customer_deposit"] },
      isActive: true,
    }),
  ]);

  const assetIds = currentAssets.map((a) => a._id);
  const liabilityIds = currentLiabilities.map((a) => a._id);

  const balanceTotals = await JournalEntry.aggregate([
    {
      $match: {
        ...tenantMatch,
        status: "posted",
      },
    },
    { $unwind: "$lines" },
    {
      $group: {
        _id: null,
        assets: {
          $sum: {
            $cond: [
              { $in: ["$lines.accountId", assetIds] },
              { $subtract: ["$lines.debit", "$lines.credit"] },
              0,
            ],
          },
        },
        liabilities: {
          $sum: {
            $cond: [
              { $in: ["$lines.accountId", liabilityIds] },
              { $subtract: ["$lines.credit", "$lines.debit"] },
              0,
            ],
          },
        },
      },
    },
  ]);

  const totalAssets = balanceTotals[0]?.assets || 0;
  const totalLiabilities = balanceTotals[0]?.liabilities || 1; // Avoid division by zero
  const currentRatio = totalLiabilities > 0 ? totalAssets / totalLiabilities : 0;

  const ratios = [
    {
      label: "Gross Margin",
      value: `${grossMargin.toFixed(1)}%`,
      benchmark: 40,
      actual: grossMargin,
      description: "Revenue after COGS",
    },
    {
      label: "Net Margin",
      value: `${netMargin.toFixed(1)}%`,
      benchmark: 15,
      actual: netMargin,
      description: "Bottom line profit",
    },
    {
      label: "Current Ratio",
      value: currentRatio.toFixed(2),
      benchmark: 1.5,
      actual: currentRatio,
      description: "Assets / Liabilities",
    },
  ];

  return (
    <ChartCard
      title="Financial Ratios"
      subtitle="Year-to-date performance"
    >
      <div className="space-y-4 pt-2">
        {ratios.map((ratio, index) => {
          const isGood = ratio.actual >= ratio.benchmark;
          return (
            <div key={index} className="space-y-1">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{ratio.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({ratio.description})
                  </span>
                </div>
                <span
                  className={`text-lg font-bold tabular-nums ${
                    isGood ? "text-green-600" : "text-orange-600"
                  }`}
                >
                  {ratio.value}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isGood ? "bg-green-500" : "bg-orange-500"
                    }`}
                    style={{
                      width: `${Math.min((ratio.actual / (ratio.benchmark * 2)) * 100, 100)}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-muted-foreground w-16 text-right">
                  Target: {ratio.benchmark}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

// ============================================
// TOP CUSTOMERS CARD
// ============================================
async function TopCustomersCard() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const tenantMatch = isSuperAdmin ? {} : { companyId: new ObjectId(companyId!) };

  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  // Get top customers by revenue (YTD)
  const topCustomers = await Invoice.aggregate([
    {
      $match: {
        ...tenantMatch,
        status: "completed",
        invoiceDate: { $gte: startOfYear },
      },
    },
    {
      $group: {
        _id: "$customer.id",
        name: { $first: "$customer.name" },
        totalRevenue: { $sum: "$total" },
        invoiceCount: { $sum: 1 },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: 5 },
  ]);

  const totalRevenue = topCustomers.reduce((sum, c) => sum + c.totalRevenue, 0);

  return (
    <ActivityCard
      title="Top Customers"
      subtitle="Year-to-date revenue"
      viewAllHref="/dashboard/reports/sales"
      isEmpty={topCustomers.length === 0}
      emptyState={
        <EmptyState title="No data yet" description="Complete some invoices to see top customers" />
      }
    >
      <div className="space-y-1">
        {topCustomers.map((customer: any, index: number) => {
          const percentage = totalRevenue > 0
            ? ((customer.totalRevenue / totalRevenue) * 100).toFixed(1)
            : 0;
          return (
            <ActivityItem
              key={customer._id || index}
              title={customer.name || "Unknown Customer"}
              subtitle={`${customer.invoiceCount} invoices • ${percentage}% of total`}
              value={formatCurrency(customer.totalRevenue)}
              badge={{
                label: `#${index + 1}`,
                className: index === 0
                  ? "text-yellow-600 bg-yellow-500/10"
                  : "text-muted-foreground bg-muted",
              }}
            />
          );
        })}
      </div>
    </ActivityCard>
  );
}

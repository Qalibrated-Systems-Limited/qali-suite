import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Scale,
  AlertTriangle,
  Clock,
  CheckCircle,
  BarChart3,
  PieChart,
} from "lucide-react";
import {
  getProfitLossData,
  getBalanceSheetData,
  getTrialBalanceData,
  getCashFlowData,
} from "@/app/mongodb/queries/reportQueries";
import { getARAgingReport, getAPAgingReport } from "@/app/mongodb/queries/aging-queries";

// ============================================
// FORMAT CURRENCY HELPER
// ============================================
const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
};

// ============================================
// PROFIT & LOSS STATS CARDS
// ============================================

export async function ProfitLossStatsCards({ startDate, endDate }) {
  const data = await getProfitLossData(startDate, endDate);
  const report = data.current;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="border-l-4 border-l-green-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <span className="text-xs text-muted-foreground">Revenue</span>
          </div>
          <p className="text-xl font-bold text-green-600 tabular-nums">
            {formatCurrency(report.revenue.total)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {report.revenue.accounts.length} accounts
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-red-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-red-500" />
            <span className="text-xs text-muted-foreground">Expenses</span>
          </div>
          <p className="text-xl font-bold text-red-600 tabular-nums">
            {formatCurrency(report.expenses.total)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {report.expenses.accounts.length} accounts
          </p>
        </CardContent>
      </Card>

      <Card className={`border-l-4 ${report.summary.netIncome >= 0 ? "border-l-blue-500" : "border-l-orange-500"}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className={`w-4 h-4 ${report.summary.netIncome >= 0 ? "text-blue-500" : "text-orange-500"}`} />
            <span className="text-xs text-muted-foreground">Net Income</span>
          </div>
          <p className={`text-xl font-bold tabular-nums ${report.summary.netIncome >= 0 ? "text-blue-600" : "text-orange-600"}`}>
            {formatCurrency(report.summary.netIncome)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {report.summary.netIncome >= 0 ? "Profit" : "Loss"}
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-purple-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <PieChart className="w-4 h-4 text-purple-500" />
            <span className="text-xs text-muted-foreground">Net Margin</span>
          </div>
          <p className="text-xl font-bold text-purple-600 tabular-nums">
            {report.summary.netMargin}%
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Profitability
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// BALANCE SHEET STATS CARDS
// ============================================

export async function BalanceSheetStatsCards({ asOfDate }) {
  const report = await getBalanceSheetData(asOfDate);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-blue-500" />
            <span className="text-xs text-muted-foreground">Total Assets</span>
          </div>
          <p className="text-xl font-bold text-blue-600 tabular-nums">
            {formatCurrency(report.summary.totalAssets)}
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-red-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-red-500" />
            <span className="text-xs text-muted-foreground">Total Liabilities</span>
          </div>
          <p className="text-xl font-bold text-red-600 tabular-nums">
            {formatCurrency(report.summary.totalLiabilities)}
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-green-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <span className="text-xs text-muted-foreground">Total Equity</span>
          </div>
          <p className="text-xl font-bold text-green-600 tabular-nums">
            {formatCurrency(report.summary.totalEquity)}
          </p>
        </CardContent>
      </Card>

      <Card className={`border-l-4 ${report.summary.isBalanced ? "border-l-green-500" : "border-l-orange-500"}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            {report.summary.isBalanced ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-orange-500" />
            )}
            <span className="text-xs text-muted-foreground">Balance Check</span>
          </div>
          <p className={`text-xl font-bold ${report.summary.isBalanced ? "text-green-600" : "text-orange-600"}`}>
            {report.summary.isBalanced ? "Balanced" : formatCurrency(report.summary.difference)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            A = L + E
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// TRIAL BALANCE STATS CARDS
// ============================================

export async function TrialBalanceStatsCards({ asOfDate, showZeroBalances }) {
  const report = await getTrialBalanceData(asOfDate, showZeroBalances);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-blue-500" />
            <span className="text-xs text-muted-foreground">Total Debits</span>
          </div>
          <p className="text-xl font-bold text-blue-600 tabular-nums">
            {formatCurrency(report.summary.totalDebits)}
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-purple-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-purple-500" />
            <span className="text-xs text-muted-foreground">Total Credits</span>
          </div>
          <p className="text-xl font-bold text-purple-600 tabular-nums">
            {formatCurrency(report.summary.totalCredits)}
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-gray-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Scale className="w-4 h-4 text-gray-500" />
            <span className="text-xs text-muted-foreground">Accounts</span>
          </div>
          <p className="text-xl font-bold text-foreground">
            {report.accounts.length}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            With activity
          </p>
        </CardContent>
      </Card>

      <Card className={`border-l-4 ${report.summary.isBalanced ? "border-l-green-500" : "border-l-red-500"}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            {report.summary.isBalanced ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-500" />
            )}
            <span className="text-xs text-muted-foreground">Status</span>
          </div>
          <p className={`text-xl font-bold ${report.summary.isBalanced ? "text-green-600" : "text-red-600"}`}>
            {report.summary.isBalanced ? "Balanced" : "Out of Balance"}
          </p>
          {!report.summary.isBalanced && (
            <p className="text-xs text-red-500 mt-1">
              Diff: {formatCurrency(report.summary.difference)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// CASH FLOW STATS CARDS
// ============================================

export async function CashFlowStatsCards({ startDate, endDate }) {
  const report = await getCashFlowData(startDate, endDate);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className={`border-l-4 ${report.summary.operatingCashFlow >= 0 ? "border-l-green-500" : "border-l-red-500"}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Operating</span>
          </div>
          <p className={`text-xl font-bold tabular-nums ${report.summary.operatingCashFlow >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatCurrency(report.summary.operatingCashFlow)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {report.operating.transactions.length} transactions
          </p>
        </CardContent>
      </Card>

      <Card className={`border-l-4 ${report.summary.investingCashFlow >= 0 ? "border-l-blue-500" : "border-l-orange-500"}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Investing</span>
          </div>
          <p className={`text-xl font-bold tabular-nums ${report.summary.investingCashFlow >= 0 ? "text-blue-600" : "text-orange-600"}`}>
            {formatCurrency(report.summary.investingCashFlow)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {report.investing.transactions.length} transactions
          </p>
        </CardContent>
      </Card>

      <Card className={`border-l-4 ${report.summary.financingCashFlow >= 0 ? "border-l-purple-500" : "border-l-yellow-500"}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Financing</span>
          </div>
          <p className={`text-xl font-bold tabular-nums ${report.summary.financingCashFlow >= 0 ? "text-purple-600" : "text-yellow-600"}`}>
            {formatCurrency(report.summary.financingCashFlow)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {report.financing.transactions.length} transactions
          </p>
        </CardContent>
      </Card>

      <Card className={`border-l-4 ${report.summary.netCashFlow >= 0 ? "border-l-green-500" : "border-l-red-500"}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Scale className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Net Cash Flow</span>
          </div>
          <p className={`text-xl font-bold tabular-nums ${report.summary.netCashFlow >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatCurrency(report.summary.netCashFlow)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// AR AGING STATS CARDS
// ============================================

export async function ARAgingStatsCards({ asOfDate }) {
  const report = await getARAgingReport(asOfDate);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-blue-500" />
            <span className="text-xs text-muted-foreground">Total AR</span>
          </div>
          <p className="text-xl font-bold text-blue-600 tabular-nums">
            {formatCurrency(report.summary.total)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {report.summary.invoiceCount} invoices
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-green-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-xs text-muted-foreground">Current</span>
          </div>
          <p className="text-xl font-bold text-green-600 tabular-nums">
            {formatCurrency(report.summary.current)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Not yet due
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-orange-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-orange-500" />
            <span className="text-xs text-muted-foreground">Overdue</span>
          </div>
          <p className="text-xl font-bold text-orange-600 tabular-nums">
            {formatCurrency(report.summary.overdueTotal)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {report.summary.overduePercent.toFixed(1)}% of total
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-red-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-xs text-muted-foreground">90+ Days</span>
          </div>
          <p className="text-xl font-bold text-red-600 tabular-nums">
            {formatCurrency(report.summary.days90plus)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Critical
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// AP AGING STATS CARDS
// ============================================

export async function APAgingStatsCards({ asOfDate }) {
  const report = await getAPAgingReport(asOfDate);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="border-l-4 border-l-purple-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-purple-500" />
            <span className="text-xs text-muted-foreground">Total AP</span>
          </div>
          <p className="text-xl font-bold text-purple-600 tabular-nums">
            {formatCurrency(report.summary.total)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {report.summary.billCount} bills
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-green-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-xs text-muted-foreground">Current</span>
          </div>
          <p className="text-xl font-bold text-green-600 tabular-nums">
            {formatCurrency(report.summary.current)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Not yet due
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-orange-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-orange-500" />
            <span className="text-xs text-muted-foreground">Overdue</span>
          </div>
          <p className="text-xl font-bold text-orange-600 tabular-nums">
            {formatCurrency(report.summary.overdueTotal)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {report.summary.overduePercent.toFixed(1)}% of total
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-red-500">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-xs text-muted-foreground">90+ Days</span>
          </div>
          <p className="text-xl font-bold text-red-600 tabular-nums">
            {formatCurrency(report.summary.days90plus)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Critical
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// SKELETONS
// ============================================

export function ReportStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, index) => (
        <Card key={index} className="border-l-4 border-l-gray-300">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton className="w-4 h-4" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-6 w-24 mb-1" />
            <Skeleton className="h-3 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ReportContentSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[...Array(8)].map((_, index) => (
            <div key={index} className="flex justify-between py-2 border-b">
              <Skeleton className="h-4 w-48" />
              <div className="flex gap-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

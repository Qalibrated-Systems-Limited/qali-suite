import { getSuppliersWithBalances, getAPAgingSummary } from "@/app/mongodb/queries/statement-queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Users, AlertTriangle, Clock } from "lucide-react";
import { SupplierStatementGenerator } from "./components/SupplierStatementGenerator";

export const metadata = {
  title: "Supplier Statements",
  description: "Generate supplier account statements",
};

export default async function SupplierStatementsPage() {
  const [suppliers, aging] = await Promise.all([
    getSuppliersWithBalances(),
    getAPAgingSummary(),
  ]);

  const formatCurrency = (amount) => {
    return `KES ${Number(amount || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Supplier Statements</h1>
        <p className="text-muted-foreground">
          Generate and download supplier account statements
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Suppliers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{suppliers.length}</div>
            <p className="text-xs text-muted-foreground">Active accounts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Payable</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(aging.totalOutstanding)}
            </div>
            <p className="text-xs text-muted-foreground">Accounts payable</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Overdue (30+ Days)</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {formatCurrency(aging.days30 + aging.days60 + aging.days90 + aging.over90)}
            </div>
            <p className="text-xs text-muted-foreground">Requires attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Critical (90+ Days)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(aging.over90)}
            </div>
            <p className="text-xs text-muted-foreground">Needs immediate action</p>
          </CardContent>
        </Card>
      </div>

      {/* Aging Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">AP Aging Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-4">
            <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
              <p className="text-sm text-muted-foreground">Current</p>
              <p className="text-xl font-bold text-green-600">
                {formatCurrency(aging.current)}
              </p>
            </div>
            <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
              <p className="text-sm text-muted-foreground">1-30 Days</p>
              <p className="text-xl font-bold text-yellow-600">
                {formatCurrency(aging.days30)}
              </p>
            </div>
            <div className="text-center p-4 bg-orange-50 dark:bg-orange-950 rounded-lg">
              <p className="text-sm text-muted-foreground">31-60 Days</p>
              <p className="text-xl font-bold text-orange-600">
                {formatCurrency(aging.days60)}
              </p>
            </div>
            <div className="text-center p-4 bg-red-50 dark:bg-red-950 rounded-lg">
              <p className="text-sm text-muted-foreground">61-90 Days</p>
              <p className="text-xl font-bold text-red-600">
                {formatCurrency(aging.days90)}
              </p>
            </div>
            <div className="text-center p-4 bg-red-100 dark:bg-red-900 rounded-lg">
              <p className="text-sm text-muted-foreground">Over 90 Days</p>
              <p className="text-xl font-bold text-red-700">
                {formatCurrency(aging.over90)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statement Generator */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Generate Statement</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplierStatementGenerator suppliers={suppliers} />
        </CardContent>
      </Card>
    </div>
  );
}

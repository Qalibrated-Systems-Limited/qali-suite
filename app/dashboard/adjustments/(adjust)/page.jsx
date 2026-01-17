import { auth } from "@/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, TrendingUp, TrendingDown, Info } from "lucide-react";

// Placeholder - will be replaced with actual queries
async function getAdjustments() {
  // TODO: Replace with actual MongoDB query
  return [];
}

async function getAdjustmentStats() {
  // TODO: Replace with actual aggregation
  return {
    totalAdjustments: 0,
    increasedValue: 0,
    decreasedValue: 0,
  };
}

export default async function AdjustmentsPage(props) {
  const session = await auth();
  const { user } = session;

  // Check if user has permission (Admin, Store Manager, Accountant)
  const hasPermission = ["Admin", "Store Manager", "Accountant"].includes(
    user?.role
  );

  if (!hasPermission) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="space-y-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            Stock Adjustments
          </h1>
          <Alert className="bg-destructive/10 border-destructive/20">
            <Info className="h-4 w-4 text-destructive" />
            <AlertDescription className="text-destructive text-xs sm:text-sm">
              You don't have permission to access stock adjustments. Contact
              your administrator.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const searchParams = await props.searchParams;
  const currentPage = Number(searchParams.page) || 1;

  const [adjustments, stats] = await Promise.all([
    getAdjustments(),
    getAdjustmentStats(),
  ]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
          Stock Adjustments
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Manage inventory adjustments and corrections
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
              Total Adjustments
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-foreground">
              {stats.totalAdjustments}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
              Increased Value
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-green-600">
              +{stats.increasedValue}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
              Decreased Value
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-red-600">
              -{stats.decreasedValue}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Empty State */}
      {adjustments.length === 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-6 sm:p-12">
            <div className="flex flex-col items-center justify-center text-center">
              <FileText className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mb-4" />
              <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">
                No stock adjustments yet
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-md">
                Stock adjustments are used to correct inventory discrepancies,
                record damaged goods, or account for inventory loss/gain. Use
                the "Create Stock Adjustment" button in the header to get
                started.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TODO: Add Adjustments Table when data exists */}
      {adjustments.length > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-4 sm:p-6">
            <p className="text-muted-foreground text-xs sm:text-sm">
              Adjustments table coming soon...
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

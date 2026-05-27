import { auth } from "@/auth";
import { canSeeInventoryNav } from "@/lib/permissions";
import { getStockValuationReport } from "@/app/mongodb/queries/inventory-queries";
import { StockValuationClient } from "./StockValuationClient";

export const metadata = {
  title: "Stock Valuation Report | Reports",
  description: "View inventory valuation by product and category",
};

export default async function InventoryReportsPage({ searchParams }) {
  const session = await auth();
  const { user } = session;

  // Single source of truth — same gate the sidebar uses for this entry.
  // Manager, CFO, Finance Manager, Sales Manager, Procurement Officer
  // and Storekeeper could see the link but the previous inline allowlist
  // bounced them.
  if (!canSeeInventoryNav(user?.role)) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h1>
          <p className="text-muted-foreground">
            You don't have permission to view this report.
          </p>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const groupBy = params?.groupBy || "category";

  let reportData = null;
  let error = null;

  try {
    reportData = await getStockValuationReport({ groupBy });
  } catch (err) {
    console.error("Error fetching stock valuation report:", err);
    error = err.message;
  }

  return (
    <StockValuationClient
      initialData={reportData}
      error={error}
    />
  );
}

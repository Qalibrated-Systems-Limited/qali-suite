import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import POForm from "../components/POForm";
import {
  fetchActiveSuppliers,
  fetchAllProducts,
  fetchPurchaseAccounts,
} from "@/app/mongodb/queries/purchase-order-queries";

// ============================================
// METADATA
// ============================================
export const metadata = {
  title: "Create Purchase Order | ERP",
  description: "Create a new supplier purchase order",
};

// ============================================
// FORM WRAPPER (Server Component)
// ============================================
async function POFormWrapper() {
  const [suppliers, products, accounts] = await Promise.all([
    fetchActiveSuppliers(),
    fetchAllProducts(),
    fetchPurchaseAccounts(),
  ]);

  // Check if we have required data
  if (suppliers.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h3 className="font-semibold">No Suppliers Found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            You need to add at least one supplier before creating purchase orders.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/parties/create?type=supplier">
            Add Supplier
          </Link>
        </Button>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h3 className="font-semibold">No Products Found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            You need to add products before creating purchase orders.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/stocks/create">
            Add Product
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <POForm
      suppliers={suppliers}
      accounts={accounts}
      products={products}
    />
  );
}

// ============================================
// PAGE COMPONENT
// ============================================
export default function CreatePurchaseOrderPage() {
  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="border-b bg-card/50">
        <div className="container max-w-4xl py-4 sm:py-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="h-8 w-8 shrink-0"
            >
              <Link href="/dashboard/purchase-orders">
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Back to purchase orders</span>
              </Link>
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Create Purchase Order
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Create a new order for goods from a supplier
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 container max-w-4xl py-6 sm:py-8">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <POFormWrapper />
        </Suspense>
      </div>
    </div>
  );
}

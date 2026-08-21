import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import POForm from "../../components/POForm";
import {
  getPurchaseOrderForDisplayPg,
  getPurchaseOrderFormDataPg,
} from "@/app/db/actions/purchase-order-actions";
import { auth } from "@/auth";
import { PROCUREMENT_ROLES } from "@/lib/utils/role-gates";

// ============================================
// METADATA
// ============================================
export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const po = await getPurchaseOrderForDisplayPg(resolvedParams.id);

  if (!po) {
    return { title: "Purchase Order Not Found" };
  }

  return {
    title: `Edit ${po.poNumber} | ERP`,
    description: `Edit purchase order ${po.poNumber}`,
  };
}

// ============================================
// FORM WRAPPER (Server Component)
// ============================================
async function POFormWrapper({ poId }) {
  const [purchaseOrder, formData] = await Promise.all([
    getPurchaseOrderForDisplayPg(poId),
    getPurchaseOrderFormDataPg(),
  ]);
  const { suppliers, products, accounts } = formData;

  if (!purchaseOrder) {
    notFound();
  }

  // Only draft POs can be edited. `status` here is the DISPLAY status, which
  // folds in receipt progress and expiry — `workflowStatus` is the one a
  // person set, and it is the one the edit rule is about.
  if (purchaseOrder.workflowStatus !== "draft") {
    redirect(`/dashboard/purchase-orders/${poId}`);
  }

  return (
    <POForm
      purchaseOrder={purchaseOrder}
      suppliers={suppliers}
      accounts={accounts}
      products={products}
    />
  );
}

// ============================================
// PAGE COMPONENT
// ============================================
export default async function UpdatePurchaseOrderPage({ params }) {
  const resolvedParams = await params;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Check permissions
  if (![...PROCUREMENT_ROLES, "Accountant"].includes(session.user.role)) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to edit purchase orders.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
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
              <Link href={`/dashboard/purchase-orders/${resolvedParams.id}`}>
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Back to purchase order</span>
              </Link>
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Edit Purchase Order
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Update purchase order details
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
          <POFormWrapper poId={resolvedParams.id} />
        </Suspense>
      </div>
    </div>
  );
}

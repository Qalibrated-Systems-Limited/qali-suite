// app/(dashboard)/dashboard/bills/new/page.jsx

import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import BillForm from "../components/BillForm";
import { getBillFormData } from "@/app/db/actions/bill-actions";
import { getAssets } from "@/app/db/actions/asset-actions";
import { getActiveProjects, getAllCostCodes } from "@/app/db/actions/project-actions";

// ============================================
// METADATA
// ============================================
export const metadata = {
  title: "Create Bill | ERP",
  description: "Create a new supplier bill",
};

// ============================================
// DATA FETCHING
// ============================================
/**
 * The fixed-asset picker, so a bill line can be tagged to the vehicle or
 * machine it was for.
 *
 * POSTGRES since 0056. Assets moved, the Mongo collection is no longer written
 * to, and this picker would have been permanently empty.
 */
async function getAssetPickerOptions() {
  const { assets } = await getAssets({
    status: ["active", "idle", "in_maintenance"],
    limit: 200,
  });
  return assets.map((a) => ({
    _id: a.id,
    assetNumber: a.assetNumber,
    name: a.name,
    registrationNumber: a.registrationNumber || "",
  }));
}


// ============================================
// LOADING FALLBACK
// ============================================
function FormSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header Skeleton */}
      <div className="h-8 w-48 bg-muted animate-pulse rounded" />
      
      {/* Card Skeletons */}
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-lg border bg-card p-6 space-y-4"
        >
          <div className="h-6 w-32 bg-muted animate-pulse rounded" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-10 bg-muted animate-pulse rounded" />
            <div className="h-10 bg-muted animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// FORM WRAPPER (Server Component)
// ============================================
async function BillFormWrapper() {
  // Suppliers, accounts and products come from Postgres and carry no
  // companyId: RLS supplies it. Assets and projects are still Mongo modules.
  const [{ suppliers, accounts, products }, assets, projects, costCodes] =
    await Promise.all([
      getBillFormData(),
      getAssetPickerOptions(),
      getActiveProjects(),
      getAllCostCodes(),
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
            You need to add at least one supplier before creating bills.
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

  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h3 className="font-semibold">No Accounts Found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            You need expense accounts (for services), inventory accounts (for
            stock purchases), or fixed asset accounts (for asset acquisitions)
            in your chart of accounts.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/accounts/create">
            Add Account
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <BillForm
      costCodes={costCodes}
      suppliers={suppliers}
      accounts={accounts}
      products={products}
      assets={assets}
      projects={projects}
    />
  );
}

// ============================================
// PAGE COMPONENT
// ============================================
export default function CreateBillPage() {
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
              <Link href="/dashboard/bills">
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Back to bills</span>
              </Link>
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Create Bill
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Record a new supplier bill for goods or services
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
          <BillFormWrapper />
        </Suspense>
      </div>
    </div>
  );
}
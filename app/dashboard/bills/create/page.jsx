// app/(dashboard)/dashboard/bills/new/page.jsx

import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import BillForm from "../components/BillForm";
import Party from "@/app/models/parties";
import Account from "@/app/models/account";
import Product from "@/app/models/product";
import Asset from "@/app/models/asset";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { getActiveProjects } from "@/app/mongodb/queries/projectQueries";

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
async function getBillFormData() {
  await dbConnect();
  const { companyId } = await getTenantContext();

  // Fetch suppliers (parties that are suppliers or both) - tenant-scoped
  const suppliers = await Party.find({
    companyId,
    type: { $in: ["supplier", "both"] },
    isActive: { $ne: false },
  })
    .select("_id name taxPin email phone address")
    .sort({ name: 1 })
    .lean();

  // Fetch expense and asset accounts for bill lines (covers services,
  // inventory purchases, and fixed asset acquisitions) - tenant-scoped
  const accounts = await Account.find({
    companyId,
    accountType: { $in: ["expense", "asset"] },
    isActive: { $ne: false },
    canPost: true,
  })
    .select("_id accountCode accountName accountType subType systemAccount")
    .sort({ accountType: -1, accountCode: 1 }) // expense first, then asset
    .lean();

  // Fetch products (optional - for inventory purchases) - tenant-scoped
  const products = await Product.find({
    companyId,
    isActive: { $ne: false },
  })
    .select("_id SKU name unit costing.costPrice costPrice")
    .sort({ name: 1 })
    .lean();

  // Fetch active fixed assets (optional per-line tagging) - tenant-scoped
  const assets = await Asset.find({
    companyId,
    status: { $in: ["active", "idle", "in_maintenance"] },
  })
    .select("_id assetNumber name registrationNumber")
    .sort({ assetNumber: 1 })
    .lean();

  // Serialize MongoDB objects for client components
  const serializedSuppliers = suppliers.map((s) => ({
    _id: s._id.toString(),
    name: s.name,
    taxPin: s.taxPin || "",
    email: s.email || "",
    phone: s.phone || "",
    address: s.address
      ? `${s.address.line1 || ""}, ${s.address.city || ""}`.trim()
      : "",
  }));

  const serializedAccounts = accounts.map((a) => ({
    _id: a._id.toString(),
    accountCode: a.accountCode,
    accountName: a.accountName,
    accountType: a.accountType,
    subType: a.subType || null,
    // Surfaced so the bill form can auto-pick Inventory when a product
    // is selected on a line (systemAccount === "inventory"), same UX
    // pattern as the PO form.
    systemAccount: a.systemAccount || null,
  }));

  const serializedProducts = products.map((p) => ({
    _id: p._id.toString(),
    sku: p.SKU,
    name: p.name,
    unit: p.unit || "pcs",
    costPrice: p.costing?.costPrice || p.costPrice || 0,
  }));

  const serializedAssets = assets.map((a) => ({
    _id: a._id.toString(),
    assetNumber: a.assetNumber,
    name: a.name,
    registrationNumber: a.registrationNumber || "",
  }));

  return {
    suppliers: serializedSuppliers,
    accounts: serializedAccounts,
    products: serializedProducts,
    assets: serializedAssets,
  };
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
  const [{ suppliers, accounts, products, assets }, projects] =
    await Promise.all([getBillFormData(), getActiveProjects()]);

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
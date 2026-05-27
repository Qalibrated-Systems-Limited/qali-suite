// app/dashboard/bills/[id]/edit/page.jsx

import { Suspense } from "react";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ChevronLeft, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import BillForm from "../../components/BillForm";
import { getBillById } from "@/app/mongodb/queries/bill-queries";
import Party from "@/app/models/parties";
import Account from "@/app/models/account";
import Product from "@/app/models/product";
import Asset from "@/app/models/asset";
import dbConnect from "@/app/config/dbConnect";
import { auth } from "@/auth";
import { serializeBsonType } from "@/lib/utils";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { getActiveProjects } from "@/app/mongodb/queries/projectQueries";

// ============================================
// METADATA
// ============================================
export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const { bill } = await getBillById(resolvedParams.id);

  if (!bill) {
    return { title: "Bill Not Found" };
  }

  return {
    title: `Edit ${bill.billNumber} | Bills`,
    description: `Edit bill ${bill.billNumber}`,
  };
}

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

  // Fetch expense and asset accounts for bill lines - tenant-scoped
  const accounts = await Account.find({
    companyId,
    accountType: { $in: ["expense", "asset"] },
    isActive: { $ne: false },
    canPost: true, // Filter out header accounts
  })
    .select("_id accountCode accountName accountType subType systemAccount")
    .sort({ accountType: -1, accountCode: 1 })
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
// FORM WRAPPER (Server Component)
// ============================================
async function BillEditFormWrapper({ billId }) {
  const [{ bill, error }, formData, projects] = await Promise.all([
    getBillById(billId),
    getBillFormData(),
    getActiveProjects(),
  ]);

  if (error || !bill) {
    notFound();
  }

  // Check if bill can be edited
  if (!bill.canEdit) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h3 className="font-semibold">Cannot Edit Bill</h3>
          <p className="text-sm text-muted-foreground mt-1">
            This bill is in &quot;{bill.status}&quot; status and cannot be edited.
            Only draft or rejected bills can be modified.
          </p>
        </div>
        <Button asChild>
          <Link href={`/dashboard/bills/${billId}`}>View Bill</Link>
        </Button>
      </div>
    );
  }

  const { suppliers, accounts, products, assets } = formData;

  return (
    <BillForm
      bill={serializeBsonType(bill)}
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
export default async function EditBillPage({ params }) {
  const resolvedParams = await params;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Check permissions
  if (!["SuperAdmin", "Admin", "Manager", "Accountant"].includes(session.user.role)) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to edit bills.
          </p>
        </div>
      </div>
    );
  }

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
              <Link href={`/dashboard/bills/${resolvedParams.id}`}>
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Back to bill</span>
              </Link>
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Edit Bill
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Modify bill details and line items
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
          <BillEditFormWrapper billId={resolvedParams.id} />
        </Suspense>
      </div>
    </div>
  );
}

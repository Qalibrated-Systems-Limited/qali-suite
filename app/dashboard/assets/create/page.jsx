import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import Account from "@/app/models/account";
import AssetForm from "@/app/dashboard/assets/components/AssetForm";

export const metadata = { title: "New Asset | Fixed Assets" };

const CREATE_ROLES = ["Admin", "Accountant"];

async function AssetFormLoader() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const accountTypes = [
    "fixed_asset",
    "accumulated_depreciation",
    "depreciation_expense",
  ];

  const accountsByType = {};
  for (const accountType of accountTypes) {
    const query = withTenantScope(
      { accountType, isActive: true },
      companyId,
      isSuperAdmin
    );
    const accounts = await Account.find(query)
      .select("accountCode accountName accountType")
      .sort({ accountCode: 1 })
      .lean();
    accountsByType[accountType] = accounts.map((a) => ({
      _id: a._id.toString(),
      accountCode: a.accountCode,
      accountName: a.accountName,
      accountType: a.accountType,
    }));
  }

  return <AssetForm accountsByType={accountsByType} />;
}

function FormSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export default async function CreateAssetPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (
    !CREATE_ROLES.includes(session.user.role) &&
    session.user.role !== "SuperAdmin"
  ) {
    redirect("/dashboard/assets");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/dashboard/assets"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Assets
        </Link>
        <span>/</span>
        <span className="text-foreground">New Asset</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">New Fixed Asset</h1>
        <p className="text-muted-foreground">
          Register a new asset and set its depreciation schedule
        </p>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <AssetFormLoader />
      </Suspense>
    </div>
  );
}

import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import Account from "@/app/models/account";
import Company from "@/app/models/Company";
import AssetForm from "@/app/dashboard/assets/components/AssetForm";
import { loadBillLineForCapitalization } from "@/app/mongodb/actions/asset-actions";

export const metadata = { title: "New Asset | Fixed Assets" };

const CREATE_ROLES = ["SuperAdmin", "Admin", "Accountant"];

async function AssetFormLoader({ fromBillLine }) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  // Load the capitalization threshold (soft policy) from company settings.
  const company = companyId
    ? await Company.findById(companyId)
        .select("settings.capitalizationThreshold")
        .lean()
    : null;
  const capitalizationThreshold =
    company?.settings?.capitalizationThreshold || 0;

  const accountTypes = [
    "fixed_asset",
    "accumulated_depreciation",
    "depreciation_expense",
  ];

  const query = withTenantScope(
    { accountType: { $in: accountTypes }, isActive: true },
    companyId,
    isSuperAdmin
  );
  const accounts = await Account.find(query)
    .select("accountCode accountName accountType")
    .sort({ accountCode: 1 })
    .lean();

  const accountsByType = Object.fromEntries(accountTypes.map((t) => [t, []]));
  for (const a of accounts) {
    accountsByType[a.accountType]?.push({
      _id: a._id.toString(),
      accountCode: a.accountCode,
      accountName: a.accountName,
      accountType: a.accountType,
    });
  }

  // Optional capitalize-from-bill prefill
  let initialValues = null;
  let capitalizationSource = null;
  let capitalizationError = null;

  if (fromBillLine) {
    const result = await loadBillLineForCapitalization(fromBillLine);
    if (result.alreadyCapitalizedAssetId) {
      redirect(`/dashboard/assets/${result.alreadyCapitalizedAssetId}`);
    }
    if (result.error) {
      capitalizationError = result.error;
    } else if (result.prefill) {
      initialValues = result.prefill;
      capitalizationSource = {
        billNumber: result.prefill.sourceReference,
        lineDescription: result.prefill.description,
      };
    }
  }

  if (capitalizationError) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-500/5 p-4 text-sm text-amber-800 dark:border-amber-900 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Cannot capitalize this line</p>
            <p className="mt-1 text-xs">{capitalizationError}</p>
          </div>
        </div>
        <AssetForm
          accountsByType={accountsByType}
          capitalizationThreshold={capitalizationThreshold}
        />
      </div>
    );
  }

  return (
    <AssetForm
      accountsByType={accountsByType}
      initialValues={initialValues}
      capitalizationSource={capitalizationSource}
      capitalizationThreshold={capitalizationThreshold}
    />
  );
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

export default async function CreateAssetPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (
    !CREATE_ROLES.includes(session.user.role) &&
    session.user.role !== "SuperAdmin"
  ) {
    redirect("/dashboard/assets");
  }

  const params = await searchParams;
  const fromBillLine =
    typeof params?.fromBillLine === "string" ? params.fromBillLine : null;

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
        <AssetFormLoader fromBillLine={fromBillLine} />
      </Suspense>
    </div>
  );
}

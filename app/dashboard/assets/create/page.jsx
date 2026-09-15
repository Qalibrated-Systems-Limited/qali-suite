import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import AssetForm from "@/app/dashboard/assets/components/AssetForm";
import { can } from "@/lib/capabilities";
import {
  loadBillLineForCapitalization,
  getAssetGlAccounts,
} from "@/app/db/actions/asset-actions";

export const metadata = { title: "New Asset | Fixed Assets" };


async function AssetFormLoader({ fromBillLine }) {
  const { companyId, isSuperAdmin } = await getTenantContext();

  // The capitalisation threshold (soft policy), from Postgres (0035).
  // 0 disables the policy and is a real value, not a missing one.
  const { getSettingsFor } = await import("@/app/db/companyConfig");
  const capitalizationThreshold = companyId
    ? Number((await getSettingsFor(String(companyId))).capitalizationThreshold)
    : 0;

  // POSTGRES. The chart of accounts stopped writing to the Mongo collection
  // when it ported, so these dropdowns were reading a store nothing maintains.
  //
  // And the grouping was wrong before that. It filtered
  // `accountType: { $in: ["fixed_asset", "accumulated_depreciation",
  // "depreciation_expense"] }` — but `accountType` only ever holds asset,
  // liability, equity, revenue or expense (lib/utils.js:373). So the query
  // matched nothing and all three dropdowns were empty, which is why no asset
  // ever carried a GL mapping and why disposal kept failing to resolve one.
  //
  // Fixed asset accounts are a SUB-TYPE; the other two are system accounts
  // with a fallback to anything of the right type, so a company that keeps
  // several can choose.
  const accounts = await getAssetGlAccounts();

  const accountsByType = {
    fixed_asset: accounts.filter((a) => a.subType === "fixed_asset"),
    accumulated_depreciation: accounts.filter(
      (a) =>
        a.systemAccount === "accumulated_depreciation" ||
        a.subType === "contra",
    ),
    depreciation_expense: accounts.filter(
      (a) =>
        a.systemAccount === "depreciation_expense" ||
        a.accountType === "expense",
    ),
  };

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
    !can(session.user.role, "asset.manage") &&
    session.user.role !== "SuperAdmin"
  ) {
    redirect("/dashboard/assets");
  }

  const params = await searchParams;
  const fromBillLine =
    typeof params?.fromBillLine === "string" ? params.fromBillLine : null;

  // Match the app-wide page padding (p-4 sm:p-6 lg:p-8) so this page aligns
  // with the rest; it previously used only p-4 sm:p-6 (missing lg:p-8).
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
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

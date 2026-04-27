import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Package,
  Truck,
  Laptop,
  Wrench,
  Sofa,
  Building2,
  MapPin,
  Cog,
  DollarSign,
  TrendingDown,
  Calendar,
  Shield,
  AlertTriangle,
  ClipboardCheck,
  FileText,
  Info,
  CheckCircle2,
  Receipt,
  ArrowRightLeft,
  History,
} from "lucide-react";
import {
  getAssetById,
  getAssetExpenses,
} from "@/app/mongodb/actions/asset-actions";
import DisposeAssetDialog from "@/app/dashboard/assets/components/DisposeAssetDialog";
import CancelDepreciationButton from "@/app/dashboard/assets/components/CancelDepreciationButton";
import TransferAssetDialog from "@/app/dashboard/assets/components/TransferAssetDialog";
import ImpairAssetDialog from "@/app/dashboard/assets/components/ImpairAssetDialog";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import Account from "@/app/models/account";

const VIEW_ROLES = ["Admin", "Accountant", "Manager"];
const ADMIN_ROLES = ["Admin"];
const POST_DEP_ROLES = ["Admin", "Accountant"];

const CATEGORY_ICONS = {
  vehicle: Truck,
  computer: Laptop,
  equipment: Wrench,
  furniture: Sofa,
  building: Building2,
  land: MapPin,
  machinery: Cog,
  other: Package,
};

const CATEGORY_LABELS = {
  vehicle: "Vehicle",
  equipment: "Equipment",
  computer: "Computer",
  furniture: "Furniture",
  building: "Building",
  land: "Land",
  machinery: "Machinery",
  other: "Other",
};

const KRA_LABELS = {
  none: "None",
  class_I: "Class I — 37.5% (Heavy machinery)",
  class_II: "Class II — 30% (Computers)",
  class_III: "Class III — 25% (Commercial vehicles)",
  class_IV: "Class IV — 12.5% (Furniture)",
};

const METHOD_LABELS = {
  straight_line: "Straight Line",
  reducing_balance: "Reducing Balance",
  none: "None",
};

export async function generateMetadata({ params }) {
  const { id } = await params;
  const result = await getAssetById(id);
  return { title: `${result.asset?.assetNumber || "Asset"} | Fixed Assets` };
}

function serializeAsset(raw) {
  if (!raw) return null;
  return {
    _id: raw._id?.toString?.() ?? raw._id,
    assetNumber: raw.assetNumber,
    name: raw.name,
    category: raw.category,
    status: raw.status,
    description: raw.description || "",
    serialNumber: raw.serialNumber || "",
    model: raw.model || "",
    manufacturer: raw.manufacturer || "",
    registrationNumber: raw.registrationNumber || "",
    location: raw.location || "",
    department: raw.department || "",
    acquisitionDate:
      raw.acquisitionDate?.toISOString?.() ?? raw.acquisitionDate ?? null,
    acquisitionCost: raw.acquisitionCost || 0,
    currency: raw.currency || "KES",
    depreciationMethod: raw.depreciationMethod || "straight_line",
    usefulLifeMonths: raw.usefulLifeMonths || 0,
    salvageValue: raw.salvageValue || 0,
    depreciationRate: raw.depreciationRate || 0,
    depreciationStartDate:
      raw.depreciationStartDate?.toISOString?.() ??
      raw.depreciationStartDate ??
      null,
    depreciationConvention: raw.depreciationConvention || "full_month",
    accumulatedDepreciation: raw.accumulatedDepreciation || 0,
    bookValue: raw.bookValue || 0,
    kraClass: raw.kraClass || "none",
    notes: raw.notes || "",
    insurance: raw.insurance
      ? {
          provider: raw.insurance.provider || "",
          policyNumber: raw.insurance.policyNumber || "",
          expiryDate:
            raw.insurance.expiryDate?.toISOString?.() ??
            raw.insurance.expiryDate ??
            null,
          premium: raw.insurance.premium || 0,
        }
      : null,
    inspection: raw.inspection
      ? {
          lastDate:
            raw.inspection.lastDate?.toISOString?.() ??
            raw.inspection.lastDate ??
            null,
          nextDueDate:
            raw.inspection.nextDueDate?.toISOString?.() ??
            raw.inspection.nextDueDate ??
            null,
        }
      : null,
    depreciationSchedule: (raw.depreciationSchedule || []).map((s) => ({
      period: s.period,
      year: s.year,
      month: s.month,
      depreciationAmount: s.depreciationAmount || 0,
      accumulatedDepreciation: s.accumulatedDepreciation || 0,
      bookValue: s.bookValue || 0,
      status: s.status || "pending",
      journalEntryId: s.journalEntryId?.toString?.() ?? s.journalEntryId ?? null,
      postedAt: s.postedAt?.toISOString?.() ?? s.postedAt ?? null,
    })),
    disposedAt: raw.disposedAt?.toISOString?.() ?? raw.disposedAt ?? null,
    disposalMethod: raw.disposalMethod || null,
    disposalAmount: raw.disposalAmount || 0,
    disposalJournalId:
      raw.disposalJournalId?.toString?.() ?? raw.disposalJournalId ?? null,
    gainOrLoss: raw.gainOrLoss || 0,
    disposalNotes: raw.disposalNotes || "",
    journalEntryIds: (raw.journalEntryIds || []).map(
      (id) => id?.toString?.() ?? id
    ),
    assignedToName: raw.assignedToName || "",
    transfers: (raw.transfers || []).map((t) => ({
      _id: t._id?.toString?.() ?? null,
      transferredAt:
        t.transferredAt?.toISOString?.() ?? t.transferredAt ?? null,
      fromLocation: t.fromLocation || "",
      toLocation: t.toLocation || "",
      fromDepartment: t.fromDepartment || "",
      toDepartment: t.toDepartment || "",
      fromAssignedToName: t.fromAssignedToName || "",
      toAssignedToName: t.toAssignedToName || "",
      reason: t.reason || "",
      transferredBy: {
        id: t.transferredBy?.id || "",
        name: t.transferredBy?.name || "",
      },
    })),
    impairments: (raw.impairments || []).map((im) => ({
      _id: im._id?.toString?.() ?? null,
      impairedAt: im.impairedAt?.toISOString?.() ?? im.impairedAt ?? null,
      amount: im.amount || 0,
      reason: im.reason || "",
      journalEntryId:
        im.journalEntryId?.toString?.() ?? im.journalEntryId ?? null,
      impairedBy: {
        id: im.impairedBy?.id || "",
        name: im.impairedBy?.name || "",
      },
    })),
    glMapping: raw.glMapping
      ? {
          assetAccount:
            raw.glMapping.assetAccount?.toString?.() ??
            raw.glMapping.assetAccount ??
            null,
          accumulatedDepreciationAccount:
            raw.glMapping.accumulatedDepreciationAccount?.toString?.() ??
            raw.glMapping.accumulatedDepreciationAccount ??
            null,
          depreciationExpenseAccount:
            raw.glMapping.depreciationExpenseAccount?.toString?.() ??
            raw.glMapping.depreciationExpenseAccount ??
            null,
        }
      : {},
    createdAt: raw.createdAt?.toISOString?.() ?? raw.createdAt ?? null,
    updatedAt: raw.updatedAt?.toISOString?.() ?? raw.updatedAt ?? null,
  };
}

function formatCurrency(amount) {
  return (amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 0 });
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({ status }) {
  const map = {
    active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    disposed: "bg-muted text-muted-foreground",
    idle: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    in_maintenance: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    written_off: "bg-red-500/15 text-red-700 dark:text-red-400",
  };
  const labels = {
    active: "Active",
    disposed: "Disposed",
    idle: "Idle",
    in_maintenance: "In Maintenance",
    written_off: "Written Off",
  };
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
        map[status] || "bg-muted text-muted-foreground"
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

function CategoryBadge({ category }) {
  const Icon = CATEGORY_ICONS[category] || Package;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      <Icon className="h-3 w-3" />
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="flex items-start justify-between border-b border-border py-3 last:border-0">
      <dt className="w-40 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="flex-1 text-right text-sm font-medium text-foreground">
        {children}
      </dd>
    </div>
  );
}

async function getAccountMap() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const accounts = await Account.find(
    withTenantScope({ isActive: true }, companyId, isSuperAdmin)
  )
    .select("accountCode accountName accountType systemAccount")
    .lean();
  return accounts;
}

export default async function AssetDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (
    !VIEW_ROLES.includes(session.user.role) &&
    session.user.role !== "SuperAdmin"
  ) {
    redirect("/dashboard");
  }

  const [result, expensesResult] = await Promise.all([
    getAssetById(id),
    getAssetExpenses(id),
  ]);
  if (!result.asset || result.error) notFound();
  const asset = serializeAsset(result.asset);
  const expenseEntries = expensesResult.success ? expensesResult.entries : [];
  const expenseTotal = expensesResult.success ? expensesResult.total : 0;

  const canDispose =
    ADMIN_ROLES.includes(session.user.role) ||
    session.user.role === "SuperAdmin";
  const canPostDep =
    POST_DEP_ROLES.includes(session.user.role) ||
    session.user.role === "SuperAdmin";
  const canTransfer =
    ["Admin", "Accountant", "Manager"].includes(session.user.role) ||
    session.user.role === "SuperAdmin";
  const canImpair =
    ["Admin", "Accountant"].includes(session.user.role) ||
    session.user.role === "SuperAdmin";

  // Accounts for dispose / impair dialogs
  let accounts = [];
  if (
    (canDispose && asset.status === "active") ||
    (canImpair && ["active", "idle"].includes(asset.status))
  ) {
    accounts = await getAccountMap();
  }

  const bankAccounts = accounts
    .filter((a) => a.accountType === "bank" || a.accountType === "cash")
    .map((a) => ({
      _id: a._id.toString(),
      accountCode: a.accountCode,
      accountName: a.accountName,
    }));
  const gainLossAccounts = accounts
    .filter(
      (a) =>
        a.systemAccount === "gain_on_disposal" ||
        a.systemAccount === "loss_on_disposal" ||
        a.accountType === "other_income" ||
        a.accountType === "other_expense"
    )
    .map((a) => ({
      _id: a._id.toString(),
      accountCode: a.accountCode,
      accountName: a.accountName,
      systemAccount: a.systemAccount || null,
    }));
  const expenseAccountsForImpair = accounts
    .filter((a) => a.accountType === "expense")
    .map((a) => ({
      _id: a._id.toString(),
      accountCode: a.accountCode,
      accountName: a.accountName,
    }));

  // Stats
  const cost = asset.acquisitionCost || 0;
  const accumDep = asset.accumulatedDepreciation || 0;
  const bookValue = asset.bookValue || 0;
  const salvage = asset.salvageValue || 0;
  const depreciableAmount = Math.max(0, cost - salvage);
  const depreciationProgress =
    depreciableAmount > 0
      ? Math.min(100, Math.round((accumDep / depreciableAmount) * 100))
      : 0;

  // Upcoming next 12 pending + all posted
  const postedEntries = asset.depreciationSchedule.filter(
    (s) => s.status === "posted"
  );
  const pendingEntries = asset.depreciationSchedule
    .filter((s) => s.status === "pending")
    .slice(0, 12);
  const displaySchedule = [...postedEntries, ...pendingEntries];

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const hasPosted = postedEntries.length > 0;
  const lastPostedPeriod =
    hasPosted ? postedEntries[postedEntries.length - 1].period : null;

  // Insurance/Inspection warnings
  const today = new Date();
  const insuranceExpiry = asset.insurance?.expiryDate
    ? new Date(asset.insurance.expiryDate)
    : null;
  const daysToInsuranceExpiry = insuranceExpiry
    ? Math.floor((insuranceExpiry - today) / (1000 * 60 * 60 * 24))
    : null;
  const insuranceWarning =
    daysToInsuranceExpiry !== null && daysToInsuranceExpiry <= 30;

  const inspectionDue = asset.inspection?.nextDueDate
    ? new Date(asset.inspection.nextDueDate)
    : null;
  const inspectionOverdue = inspectionDue ? inspectionDue < today : false;

  const hasInsurance =
    asset.insurance &&
    (asset.insurance.provider ||
      asset.insurance.policyNumber ||
      asset.insurance.expiryDate);
  const hasInspection =
    asset.inspection &&
    (asset.inspection.lastDate || asset.inspection.nextDueDate);

  return (
    <div className="max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/dashboard/assets"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Assets
        </Link>
        <span>/</span>
        <span className="font-mono text-foreground">{asset.assetNumber}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">
              {asset.name}
            </h1>
            <StatusBadge status={asset.status} />
            <CategoryBadge category={asset.category} />
          </div>
          <p className="mt-1 truncate font-mono text-sm text-muted-foreground">
            {asset.assetNumber}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!["disposed", "written_off"].includes(asset.status) && canTransfer && (
            <TransferAssetDialog asset={asset} />
          )}
          {["active", "idle"].includes(asset.status) && canImpair && (
            <ImpairAssetDialog
              asset={asset}
              expenseAccounts={expenseAccountsForImpair}
            />
          )}
          {asset.status === "active" && canDispose && (
            <DisposeAssetDialog
              asset={asset}
              bankAccounts={bankAccounts}
              gainLossAccounts={gainLossAccounts}
            />
          )}
          {asset.status === "active" && canPostDep && hasPosted && (
            <CancelDepreciationButton
              assetId={asset._id}
              period={lastPostedPeriod}
            />
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            <p className="text-xs font-medium uppercase tracking-wide">
              Acquisition Cost
            </p>
          </div>
          <p className="mt-2 text-xl font-bold text-foreground">
            KES {formatCurrency(cost)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingDown className="h-4 w-4" />
            <p className="text-xs font-medium uppercase tracking-wide">
              Accumulated Dep
            </p>
          </div>
          <p className="mt-2 text-xl font-bold text-foreground">
            KES {formatCurrency(accumDep)}
          </p>
        </div>
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-primary">
            <DollarSign className="h-4 w-4" />
            <p className="text-xs font-medium uppercase tracking-wide">
              Book Value
            </p>
          </div>
          <p className="mt-2 text-xl font-bold text-primary">
            KES {formatCurrency(bookValue)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <p className="text-xs font-medium uppercase tracking-wide">
              Dep Progress
            </p>
          </div>
          <p className="mt-2 text-xl font-bold text-foreground">
            {depreciationProgress}%
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-emerald-500 transition-all"
              style={{ width: `${depreciationProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Disposal info */}
      {asset.status === "disposed" && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Info className="h-4 w-4 text-muted-foreground" /> Disposal Details
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <InfoRow label="Disposed On">{formatDate(asset.disposedAt)}</InfoRow>
            <InfoRow label="Method">
              {asset.disposalMethod
                ? asset.disposalMethod.charAt(0).toUpperCase() +
                  asset.disposalMethod.slice(1)
                : "—"}
            </InfoRow>
            <InfoRow label="Amount">
              KES {formatCurrency(asset.disposalAmount)}
            </InfoRow>
            <InfoRow label="Gain / (Loss)">
              <span
                className={
                  asset.gainOrLoss > 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : asset.gainOrLoss < 0
                      ? "text-red-700 dark:text-red-400"
                      : ""
                }
              >
                KES {formatCurrency(asset.gainOrLoss)}
              </span>
            </InfoRow>
          </dl>
          {asset.disposalNotes && (
            <p className="mt-3 text-sm text-muted-foreground">
              {asset.disposalNotes}
            </p>
          )}
        </div>
      )}

      {/* Details Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileText className="h-4 w-4 text-muted-foreground" /> Asset Info
          </h2>
          <dl>
            <InfoRow label="Name">{asset.name}</InfoRow>
            <InfoRow label="Category">
              {CATEGORY_LABELS[asset.category] || asset.category}
            </InfoRow>
            <InfoRow label="Serial Number">
              <span className="font-mono text-xs">
                {asset.serialNumber || "—"}
              </span>
            </InfoRow>
            <InfoRow label="Model">{asset.model || "—"}</InfoRow>
            <InfoRow label="Manufacturer">{asset.manufacturer || "—"}</InfoRow>
            <InfoRow label="Registration">
              <span className="font-mono text-xs">
                {asset.registrationNumber || "—"}
              </span>
            </InfoRow>
            <InfoRow label="Location">{asset.location || "—"}</InfoRow>
            <InfoRow label="Department">{asset.department || "—"}</InfoRow>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <DollarSign className="h-4 w-4 text-muted-foreground" /> Financial
          </h2>
          <dl>
            <InfoRow label="Acquisition Date">
              {formatDate(asset.acquisitionDate)}
            </InfoRow>
            <InfoRow label="Acquisition Cost">
              KES {formatCurrency(asset.acquisitionCost)}
            </InfoRow>
            <InfoRow label="Currency">{asset.currency || "KES"}</InfoRow>
            <InfoRow label="Depreciation Method">
              {METHOD_LABELS[asset.depreciationMethod] || asset.depreciationMethod}
            </InfoRow>
            {asset.depreciationMethod === "straight_line" && (
              <InfoRow label="First-Period Convention">
                {asset.depreciationConvention === "pro_rata"
                  ? "Pro-Rata (by days)"
                  : "Full Month"}
              </InfoRow>
            )}
            <InfoRow label="Useful Life">
              {asset.usefulLifeMonths > 0
                ? `${asset.usefulLifeMonths} months`
                : "—"}
            </InfoRow>
            <InfoRow label="Salvage Value">
              KES {formatCurrency(asset.salvageValue)}
            </InfoRow>
            <InfoRow label="Dep Start Date">
              {formatDate(asset.depreciationStartDate)}
            </InfoRow>
            <InfoRow label="KRA Class">
              {KRA_LABELS[asset.kraClass] || asset.kraClass}
            </InfoRow>
          </dl>
        </div>
      </div>

      {/* Insurance & Inspection */}
      {(hasInsurance || hasInspection) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {hasInsurance && (
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Shield className="h-4 w-4 text-muted-foreground" /> Insurance
              </h2>
              <dl>
                <InfoRow label="Provider">
                  {asset.insurance.provider || "—"}
                </InfoRow>
                <InfoRow label="Policy Number">
                  <span className="font-mono text-xs">
                    {asset.insurance.policyNumber || "—"}
                  </span>
                </InfoRow>
                <InfoRow label="Expiry">
                  <span
                    className={
                      insuranceWarning
                        ? "text-amber-700 dark:text-amber-400"
                        : ""
                    }
                  >
                    {formatDate(asset.insurance.expiryDate)}
                    {insuranceWarning && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs">
                        <AlertTriangle className="h-3 w-3" />
                        {daysToInsuranceExpiry <= 0
                          ? "Expired"
                          : `${daysToInsuranceExpiry}d left`}
                      </span>
                    )}
                  </span>
                </InfoRow>
                {asset.insurance.premium > 0 && (
                  <InfoRow label="Premium">
                    KES {formatCurrency(asset.insurance.premium)}
                  </InfoRow>
                )}
              </dl>
            </div>
          )}

          {hasInspection && (
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <ClipboardCheck className="h-4 w-4 text-muted-foreground" />{" "}
                Inspection
              </h2>
              <dl>
                <InfoRow label="Last Inspection">
                  {formatDate(asset.inspection.lastDate)}
                </InfoRow>
                <InfoRow label="Next Due">
                  <span
                    className={
                      inspectionOverdue
                        ? "text-red-700 dark:text-red-400"
                        : ""
                    }
                  >
                    {formatDate(asset.inspection.nextDueDate)}
                    {inspectionOverdue && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs">
                        <AlertTriangle className="h-3 w-3" /> Overdue
                      </span>
                    )}
                  </span>
                </InfoRow>
              </dl>
            </div>
          )}
        </div>
      )}

      {/* Depreciation Schedule */}
      {displaySchedule.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Calendar className="h-4 w-4 text-muted-foreground" /> Depreciation
            Schedule
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Showing {postedEntries.length} posted + next {pendingEntries.length}{" "}
            pending of {asset.depreciationSchedule.length} total
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Accumulated</th>
                  <th className="px-3 py-2 text-right">Book Value</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">JE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displaySchedule.map((s, i) => {
                  const isPosted = s.status === "posted";
                  const isCurrent = s.period === currentPeriod;
                  return (
                    <tr
                      key={`${s.period}-${i}`}
                      className={`${
                        isPosted
                          ? "bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                          : ""
                      } ${isCurrent ? "bg-primary/5" : ""}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        {s.period}
                        {isCurrent && (
                          <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            Current
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatCurrency(s.depreciationAmount)}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {formatCurrency(s.accumulatedDepreciation)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatCurrency(s.bookValue)}
                      </td>
                      <td className="px-3 py-2">
                        {isPosted ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Posted
                          </span>
                        ) : s.status === "skipped" ? (
                          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            Skipped
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {s.journalEntryId ? (
                          <Link
                            href={`/dashboard/journal/${s.journalEntryId}`}
                            className="text-xs text-primary hover:underline"
                          >
                            View
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Expense History (bills tagged to this asset) */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Receipt className="h-4 w-4 text-muted-foreground" /> Expense
            History
          </h2>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Total Spent
            </p>
            <p className="text-base font-bold text-foreground">
              KES {formatCurrency(expenseTotal)}
            </p>
          </div>
        </div>
        {expenseEntries.length === 0 ? (
          <p className="rounded-md bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">
            No expenses tagged to this asset yet. Tag bill lines to this asset
            to track maintenance, repairs, fuel, and running costs.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Bill #</th>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {expenseEntries.map((e) => (
                  <tr
                    key={`${e.billId}-${e.lineDescription}-${e.amount}`}
                    className="hover:bg-muted/30"
                  >
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDate(e.billDate)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {e.billNumber}
                    </td>
                    <td className="px-3 py-2">{e.supplierName}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {e.lineDescription}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      <span className="font-mono">{e.accountCode}</span>{" "}
                      {e.accountName}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatCurrency(e.amount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/dashboard/bills/${e.billId}`}
                        className="text-xs text-primary hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transfer History */}
      {asset.transfers.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" /> Transfer
            History
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Custodian</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...asset.transfers]
                  .reverse()
                  .map((t) => (
                    <tr key={t._id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(t.transferredAt)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-muted-foreground">
                          {t.fromLocation || "—"}
                        </span>
                        <span className="mx-1 text-muted-foreground">→</span>
                        <span className="font-medium">
                          {t.toLocation || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-muted-foreground">
                          {t.fromDepartment || "—"}
                        </span>
                        <span className="mx-1 text-muted-foreground">→</span>
                        <span className="font-medium">
                          {t.toDepartment || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-muted-foreground">
                          {t.fromAssignedToName || "—"}
                        </span>
                        <span className="mx-1 text-muted-foreground">→</span>
                        <span className="font-medium">
                          {t.toAssignedToName || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {t.reason}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {t.transferredBy?.name || "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Impairment History */}
      {asset.impairments.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <History className="h-4 w-4 text-muted-foreground" /> Impairment
            History
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">JE</th>
                  <th className="px-3 py-2">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...asset.impairments]
                  .reverse()
                  .map((im) => (
                    <tr key={im._id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(im.impairedAt)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-red-700 dark:text-red-400">
                        KES {formatCurrency(im.amount)}
                      </td>
                      <td className="px-3 py-2">{im.reason}</td>
                      <td className="px-3 py-2">
                        {im.journalEntryId ? (
                          <Link
                            href={`/dashboard/journal/${im.journalEntryId}`}
                            className="text-xs text-primary hover:underline"
                          >
                            View
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {im.impairedBy?.name || "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Notes */}
      {asset.notes && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Notes</h2>
          <p className="whitespace-pre-line text-sm text-muted-foreground">
            {asset.notes}
          </p>
        </div>
      )}

      {/* Journal Entries */}
      {asset.journalEntryIds.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileText className="h-4 w-4 text-muted-foreground" /> Related
            Journal Entries
          </h2>
          <div className="space-y-2">
            {asset.journalEntryIds.map((jeId) => (
              <Link
                key={jeId}
                href={`/dashboard/journal/${jeId}`}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {jeId}
                </span>
                <span className="text-xs text-primary">View &rarr;</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

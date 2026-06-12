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
  ExternalLink,
  Briefcase,
  User,
  Gauge,
  Activity,
  Fuel,
  ShieldCheck,
  CircleDashed,
  Printer,
  Hammer,
} from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  getAssetById,
  getAssetExpenses,
  getAssetRunningCosts,
} from "@/app/mongodb/actions/asset-actions";
import DisposeAssetDialog from "@/app/dashboard/assets/components/DisposeAssetDialog";
import CancelDepreciationButton from "@/app/dashboard/assets/components/CancelDepreciationButton";
import TransferAssetDialog from "@/app/dashboard/assets/components/TransferAssetDialog";
import ImpairAssetDialog from "@/app/dashboard/assets/components/ImpairAssetDialog";
import LogUsageDialog from "@/app/dashboard/assets/components/LogUsageDialog";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import Account from "@/app/models/account";

const VIEW_ROLES = ["SuperAdmin", "Admin", "CEO", "CFO", "Finance Manager", "Accountant", "Manager"];
const ADMIN_ROLES = ["SuperAdmin", "Admin"];
const POST_DEP_ROLES = ["SuperAdmin", "Admin", "Accountant"];

const CATEGORY_ICONS = {
  land: MapPin,
  building: Building2,
  leasehold_improvement: Hammer,
  vehicle: Truck,
  machinery: Cog,
  office_equipment: Printer,
  computer: Laptop,
  furniture: Sofa,
  equipment: Wrench,
  other: Package,
};

const CATEGORY_LABELS = {
  land: "Land",
  building: "Building",
  leasehold_improvement: "Leasehold Improvement",
  vehicle: "Vehicle",
  machinery: "Plant & Machinery",
  office_equipment: "Office Equipment",
  computer: "Computer Equipment",
  furniture: "Furniture & Fittings",
  equipment: "Tools & Equipment",
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
    usageUnit: raw.usageUnit || "km",
    currentUsage: raw.currentUsage || 0,
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

function formatCompact(amount) {
  const n = amount || 0;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-KE", { minimumFractionDigits: 0 });
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
    active:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20",
    disposed: "bg-muted text-muted-foreground ring-border",
    idle: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20",
    in_maintenance:
      "bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-blue-500/20",
    written_off: "bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20",
  };
  const labels = {
    active: "Active",
    disposed: "Disposed",
    idle: "Idle",
    in_maintenance: "Maintenance",
    written_off: "Written Off",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        map[status] || "bg-muted text-muted-foreground ring-border"
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

function CategoryPill({ category }) {
  const Icon = CATEGORY_ICONS[category] || Package;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Icon className="h-3 w-3" />
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

function MetaPill({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" />
      <span className="truncate">{children}</span>
    </span>
  );
}

function StatTile({ icon: Icon, label, value, accent }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div
        className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wide ${
          accent ? "text-primary" : "text-muted-foreground"
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p
        className={`mt-1.5 truncate text-base font-semibold sm:text-lg ${
          accent ? "text-primary" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 border-b border-border py-2.5 text-sm last:border-0 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="wrap-break-word font-medium text-foreground sm:text-right">
        {children}
      </dd>
    </div>
  );
}

function Section({ icon: Icon, title, action, children }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          {title}
        </h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ============================================
// COSTS-TAB HELPERS
// ============================================
const HEALTH_STYLES = {
  healthy: {
    label: "Healthy",
    pill:
      "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
    icon: ShieldCheck,
  },
  watch: {
    label: "Watch",
    pill:
      "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
    icon: AlertTriangle,
  },
  high: {
    label: "High costs",
    pill: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
    icon: AlertTriangle,
  },
};

const BUCKET_META = {
  fuel: { label: "Fuel", icon: Fuel, color: "bg-orange-500" },
  maintenance: {
    label: "Maintenance",
    icon: Wrench,
    color: "bg-blue-500",
  },
  insurance: {
    label: "Insurance",
    icon: ShieldCheck,
    color: "bg-violet-500",
  },
  other: { label: "Other", icon: CircleDashed, color: "bg-zinc-400" },
};

function HealthPill({ level }) {
  const cfg = HEALTH_STYLES[level] || HEALTH_STYLES.healthy;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${cfg.pill}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {cfg.label}
    </span>
  );
}

// SVG sparkline — area + line. Pure server-rendered, no JS required.
function Sparkline({ data = [], height = 48, accent = "rgb(16 185 129)" }) {
  const values = data.map((d) => d.total || 0);
  const max = Math.max(1, ...values);
  const width = 240; // viewBox width — scales via CSS
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const scaleY = (v) => height - 6 - (v / max) * (height - 12);

  const points = data.map((d, i) => [i * stepX, scaleY(d.total || 0)]);
  const linePath = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${width.toFixed(1)},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-12 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Monthly cost trend"
    >
      <path d={areaPath} fill={accent} fillOpacity="0.12" />
      <path
        d={linePath}
        fill="none"
        stroke={accent}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={data[i].total > 0 ? 1.8 : 1.2}
          fill={accent}
          fillOpacity={data[i].total > 0 ? 1 : 0.4}
        />
      ))}
    </svg>
  );
}

function BucketBar({ bucketTotals, total }) {
  if (!total || total <= 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No expenses tagged in the last 12 months.
      </p>
    );
  }
  const order = ["fuel", "maintenance", "insurance", "other"];
  const segments = order
    .map((k) => ({
      key: k,
      meta: BUCKET_META[k],
      value: bucketTotals[k] || 0,
      pct: ((bucketTotals[k] || 0) / total) * 100,
    }))
    .filter((s) => s.value > 0);

  return (
    <div className="space-y-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((s) => (
          <div
            key={s.key}
            className={s.meta.color}
            style={{ width: `${s.pct}%` }}
            title={`${s.meta.label}: ${s.pct.toFixed(0)}%`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {segments.map((s) => {
          const Icon = s.meta.icon;
          return (
            <li
              key={s.key}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5"
            >
              <span className={`h-2 w-2 rounded-full ${s.meta.color}`} />
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-muted-foreground">
                  {s.meta.label}
                </p>
                <p className="truncate text-xs font-semibold tabular-nums">
                  {(s.value || 0).toLocaleString("en-KE", {
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
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

  const [result, expensesResult, costsResult] = await Promise.all([
    getAssetById(id),
    getAssetExpenses(id),
    getAssetRunningCosts(id),
  ]);
  if (!result.asset || result.error) notFound();
  const asset = serializeAsset(result.asset);
  const expenseEntries = expensesResult.success ? expensesResult.entries : [];
  const expenseTotal = expensesResult.success ? expensesResult.total : 0;
  const costs = costsResult.success ? costsResult : null;

  const canDispose =
    ADMIN_ROLES.includes(session.user.role) ||
    session.user.role === "SuperAdmin";
  const canPostDep =
    POST_DEP_ROLES.includes(session.user.role) ||
    session.user.role === "SuperAdmin";
  const canTransfer =
    ["SuperAdmin", "Admin", "Accountant", "Manager"].includes(session.user.role) ||
    session.user.role === "SuperAdmin";
  const canImpair =
    ["SuperAdmin", "Admin", "Accountant"].includes(session.user.role) ||
    session.user.role === "SuperAdmin";

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
  const lastPostedPeriod = hasPosted
    ? postedEntries[postedEntries.length - 1].period
    : null;

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

  const hasTransfers = asset.transfers.length > 0;
  const hasImpairments = asset.impairments.length > 0;
  const hasJournalEntries = asset.journalEntryIds.length > 0;
  const activityCount =
    (hasTransfers ? asset.transfers.length : 0) +
    (hasImpairments ? asset.impairments.length : 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          href="/dashboard/assets"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Assets
        </Link>
        <span>/</span>
        <span className="truncate font-mono text-foreground">
          {asset.assetNumber}
        </span>
      </nav>

      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="wrap-break-word text-xl font-semibold text-foreground sm:text-2xl">
              {asset.name}
            </h1>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground sm:text-sm">
              {asset.assetNumber}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {!["disposed", "written_off"].includes(asset.status) && (
              <LogUsageDialog
                asset={{
                  _id: asset._id,
                  name: asset.name,
                  assetNumber: asset.assetNumber,
                  usageUnit: asset.usageUnit,
                  currentUsage: asset.currentUsage,
                }}
              />
            )}
            {!["disposed", "written_off"].includes(asset.status) &&
              canTransfer && <TransferAssetDialog asset={asset} />}
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

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusBadge status={asset.status} />
          <CategoryPill category={asset.category} />
          {asset.location && <MetaPill icon={MapPin}>{asset.location}</MetaPill>}
          {asset.department && (
            <MetaPill icon={Briefcase}>{asset.department}</MetaPill>
          )}
          {asset.assignedToName && (
            <MetaPill icon={User}>{asset.assignedToName}</MetaPill>
          )}
          <MetaPill icon={Calendar}>
            Acquired {formatDate(asset.acquisitionDate)}
          </MetaPill>
        </div>
      </header>

      {/* Alerts */}
      {(insuranceWarning || inspectionOverdue) && (
        <div className="mt-4 space-y-2">
          {insuranceWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Insurance{" "}
                {daysToInsuranceExpiry <= 0
                  ? "has expired"
                  : `expires in ${daysToInsuranceExpiry} day${daysToInsuranceExpiry === 1 ? "" : "s"}`}
                {asset.insurance?.expiryDate &&
                  ` (${formatDate(asset.insurance.expiryDate)})`}
              </p>
            </div>
          )}
          {inspectionOverdue && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Inspection overdue
                {asset.inspection?.nextDueDate &&
                  ` since ${formatDate(asset.inspection.nextDueDate)}`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Disposal banner */}
      {asset.status === "disposed" && (
        <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Info className="h-4 w-4 text-muted-foreground" />
            Disposed
          </h2>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="font-medium">{formatDate(asset.disposedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Method</p>
              <p className="font-medium capitalize">
                {asset.disposalMethod || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Amount</p>
              <p className="font-medium tabular-nums">
                KES {formatCurrency(asset.disposalAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Gain / (Loss)</p>
              <p
                className={`font-medium tabular-nums ${
                  asset.gainOrLoss > 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : asset.gainOrLoss < 0
                      ? "text-red-700 dark:text-red-400"
                      : ""
                }`}
              >
                KES {formatCurrency(asset.gainOrLoss)}
              </p>
            </div>
          </div>
          {asset.disposalNotes && (
            <p className="mt-3 text-sm text-muted-foreground">
              {asset.disposalNotes}
            </p>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatTile
          icon={DollarSign}
          label="Cost"
          value={`KES ${formatCompact(cost)}`}
        />
        <StatTile
          icon={TrendingDown}
          label="Accum. Dep"
          value={`KES ${formatCompact(accumDep)}`}
        />
        <StatTile
          icon={DollarSign}
          label="Book Value"
          value={`KES ${formatCompact(bookValue)}`}
          accent
        />
        <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            Dep Progress
          </div>
          <p className="mt-1.5 text-base font-semibold sm:text-lg">
            {depreciationProgress}%
          </p>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-emerald-500 transition-all"
              style={{ width: `${depreciationProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="mt-6 gap-4">
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <TabsList className="mx-4 h-9 sm:mx-0">
            <TabsTrigger value="overview" className="px-3">
              Overview
            </TabsTrigger>
            <TabsTrigger value="costs" className="px-3">
              Costs
              {costs?.health?.level && costs.health.level !== "healthy" && (
                <span
                  className={`ml-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                    costs.health.level === "high"
                      ? "bg-red-500"
                      : "bg-amber-500"
                  }`}
                  aria-label={costs.health.level}
                />
              )}
            </TabsTrigger>
            <TabsTrigger value="depreciation" className="px-3">
              Depreciation
              {displaySchedule.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-medium tabular-nums">
                  {asset.depreciationSchedule.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="expenses" className="px-3">
              Expenses
              {expenseEntries.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-medium tabular-nums">
                  {expenseEntries.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity" className="px-3">
              Activity
              {activityCount > 0 && (
                <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-medium tabular-nums">
                  {activityCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Section icon={FileText} title="Asset Details">
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
                <InfoRow label="Manufacturer">
                  {asset.manufacturer || "—"}
                </InfoRow>
                <InfoRow label="Registration">
                  <span className="font-mono text-xs">
                    {asset.registrationNumber || "—"}
                  </span>
                </InfoRow>
                <InfoRow label="Location">{asset.location || "—"}</InfoRow>
                <InfoRow label="Department">
                  {asset.department || "—"}
                </InfoRow>
              </dl>
            </Section>

            <Section icon={DollarSign} title="Financial">
              <dl>
                <InfoRow label="Acquisition Date">
                  {formatDate(asset.acquisitionDate)}
                </InfoRow>
                <InfoRow label="Acquisition Cost">
                  <span className="tabular-nums">
                    KES {formatCurrency(asset.acquisitionCost)}
                  </span>
                </InfoRow>
                <InfoRow label="Currency">{asset.currency || "KES"}</InfoRow>
                <InfoRow label="Method">
                  {METHOD_LABELS[asset.depreciationMethod] ||
                    asset.depreciationMethod}
                </InfoRow>
                {asset.depreciationMethod === "straight_line" && (
                  <InfoRow label="Convention">
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
                  <span className="tabular-nums">
                    KES {formatCurrency(asset.salvageValue)}
                  </span>
                </InfoRow>
                <InfoRow label="Dep Start">
                  {formatDate(asset.depreciationStartDate)}
                </InfoRow>
                <InfoRow label="KRA Class">
                  {KRA_LABELS[asset.kraClass] || asset.kraClass}
                </InfoRow>
              </dl>
            </Section>
          </div>

          {(hasInsurance || hasInspection) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {hasInsurance && (
                <Section icon={Shield} title="Insurance">
                  <dl>
                    <InfoRow label="Provider">
                      {asset.insurance.provider || "—"}
                    </InfoRow>
                    <InfoRow label="Policy #">
                      <span className="font-mono text-xs">
                        {asset.insurance.policyNumber || "—"}
                      </span>
                    </InfoRow>
                    <InfoRow label="Expiry">
                      <span
                        className={`flex flex-wrap items-center gap-2 sm:justify-end ${
                          insuranceWarning
                            ? "text-amber-700 dark:text-amber-400"
                            : ""
                        }`}
                      >
                        {formatDate(asset.insurance.expiryDate)}
                        {insuranceWarning && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs">
                            <AlertTriangle className="h-3 w-3" />
                            {daysToInsuranceExpiry <= 0
                              ? "Expired"
                              : `${daysToInsuranceExpiry}d`}
                          </span>
                        )}
                      </span>
                    </InfoRow>
                    {asset.insurance.premium > 0 && (
                      <InfoRow label="Premium">
                        <span className="tabular-nums">
                          KES {formatCurrency(asset.insurance.premium)}
                        </span>
                      </InfoRow>
                    )}
                  </dl>
                </Section>
              )}

              {hasInspection && (
                <Section icon={ClipboardCheck} title="Inspection">
                  <dl>
                    <InfoRow label="Last Inspection">
                      {formatDate(asset.inspection.lastDate)}
                    </InfoRow>
                    <InfoRow label="Next Due">
                      <span
                        className={`flex flex-wrap items-center gap-2 sm:justify-end ${
                          inspectionOverdue
                            ? "text-red-700 dark:text-red-400"
                            : ""
                        }`}
                      >
                        {formatDate(asset.inspection.nextDueDate)}
                        {inspectionOverdue && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs">
                            <AlertTriangle className="h-3 w-3" />
                            Overdue
                          </span>
                        )}
                      </span>
                    </InfoRow>
                  </dl>
                </Section>
              )}
            </div>
          )}

          {asset.notes && (
            <Section icon={FileText} title="Notes">
              <p className="whitespace-pre-line text-sm text-muted-foreground">
                {asset.notes}
              </p>
            </Section>
          )}
        </TabsContent>

        {/* COSTS TAB */}
        <TabsContent value="costs" className="space-y-4">
          {!costs ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <Activity className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Running-cost analytics not available.
              </p>
            </div>
          ) : (
            <>
              {/* Health summary card */}
              <Section
                icon={Activity}
                title="Running cost health"
                action={<HealthPill level={costs.health.level} />}
              >
                <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Trailing 12 months
                      </p>
                      <p className="mt-0.5 text-2xl font-semibold tabular-nums">
                        KES {formatCurrency(costs.trailing12.total)}
                      </p>
                    </div>
                    <ul className="space-y-1.5 text-sm">
                      {costs.health.reasons.map((r, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-muted-foreground"
                        >
                          <span
                            className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${
                              costs.health.level === "high"
                                ? "bg-red-500"
                                : costs.health.level === "watch"
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                            }`}
                          />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      12-month trend
                    </p>
                    <Sparkline data={costs.trailing12.byMonth} />
                    <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                      <span>{costs.trailing12.byMonth[0]?.period}</span>
                      <span>
                        {
                          costs.trailing12.byMonth[
                            costs.trailing12.byMonth.length - 1
                          ]?.period
                        }
                      </span>
                    </div>
                  </div>
                </div>
              </Section>

              {/* Key metrics row */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                <StatTile
                  icon={Gauge}
                  label={`Cost / ${costs.usage.unit}`}
                  value={
                    costs.usage.costPerUnit !== null
                      ? `KES ${costs.usage.costPerUnit.toLocaleString("en-KE", {
                          maximumFractionDigits: 1,
                        })}`
                      : "—"
                  }
                />
                <StatTile
                  icon={Activity}
                  label="Peer ratio"
                  value={
                    costs.peers?.ratio !== null &&
                    costs.peers?.ratio !== undefined
                      ? `${costs.peers.ratio.toFixed(2)}×`
                      : "—"
                  }
                  accent={
                    costs.peers?.ratio !== null &&
                    costs.peers?.ratio !== undefined &&
                    costs.peers.ratio > 1.0
                  }
                />
                <StatTile
                  icon={Wrench}
                  label="Maint % of book"
                  value={
                    costs.ratios.maintenancePctOfBook !== null
                      ? `${costs.ratios.maintenancePctOfBook.toFixed(0)}%`
                      : "—"
                  }
                />
                <StatTile
                  icon={Gauge}
                  label={`Distance / ${costs.usage.unit}`}
                  value={
                    costs.usage.distance !== null
                      ? costs.usage.distance.toLocaleString("en-KE", {
                          maximumFractionDigits: 0,
                        })
                      : "—"
                  }
                />
              </div>

              {/* Spend breakdown */}
              <Section icon={Activity} title="Spend by category">
                <BucketBar
                  bucketTotals={costs.trailing12.byBucket}
                  total={costs.trailing12.total}
                />
              </Section>

              {/* Peer comparison */}
              {costs.peers && (
                <Section icon={Activity} title="Peer comparison">
                  {costs.peers.peerCount === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No other {asset.category}s in your fleet to compare
                      against.
                    </p>
                  ) : costs.peers.median === null ? (
                    <p className="text-sm text-muted-foreground">
                      No spend data yet for peer {asset.category}s — comparison
                      will appear once expenses are tagged.
                    </p>
                  ) : (
                    <dl className="grid gap-2 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Peers in {asset.category} category
                        </dt>
                        <dd className="font-semibold tabular-nums">
                          {costs.peers.peerCount} (
                          {costs.peers.peersWithSpend} with spend)
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Peer median (12mo)
                        </dt>
                        <dd className="font-semibold tabular-nums">
                          KES {formatCurrency(costs.peers.median)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          This asset vs peers
                        </dt>
                        <dd
                          className={`font-semibold tabular-nums ${
                            costs.peers.ratio > 1.5
                              ? "text-red-600 dark:text-red-400"
                              : costs.peers.ratio > 1.0
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {costs.peers.ratio !== null
                            ? `${costs.peers.ratio.toFixed(2)}× peer median`
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                  )}
                </Section>
              )}

              {/* Usage readings log */}
              <Section
                icon={Gauge}
                title={`Usage readings (${costs.usage.unit})`}
                action={
                  !["disposed", "written_off"].includes(asset.status) ? (
                    <LogUsageDialog asset={costs.asset} />
                  ) : null
                }
              >
                {costs.readings.length === 0 ? (
                  <p className="rounded-md bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
                    No readings logged yet. Log the current odometer / hours
                    value to enable cost-per-{costs.usage.unit} analytics.
                  </p>
                ) : (
                  <ul className="-mx-4 -mb-4 divide-y divide-border">
                    {costs.readings.map((r, i) => (
                      <li
                        key={r._id || i}
                        className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold tabular-nums">
                            {r.reading.toLocaleString()}{" "}
                            <span className="text-xs font-normal text-muted-foreground">
                              {r.unit}
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatDate(r.recordedAt)}
                            {r.recordedBy && ` · ${r.recordedBy}`}
                            {r.source !== "manual" && ` · ${r.source}`}
                          </p>
                          {r.notes && (
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {r.notes}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                    {costs.readingsTotal > costs.readings.length && (
                      <li className="px-4 py-2 text-center text-xs text-muted-foreground">
                        Showing {costs.readings.length} of{" "}
                        {costs.readingsTotal} readings
                      </li>
                    )}
                  </ul>
                )}
              </Section>
            </>
          )}
        </TabsContent>

        {/* DEPRECIATION TAB */}
        <TabsContent value="depreciation" className="space-y-4">
          {displaySchedule.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <Calendar className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No depreciation schedule yet.
              </p>
            </div>
          ) : (
            <Section
              icon={Calendar}
              title="Depreciation Schedule"
              action={
                <span className="text-xs text-muted-foreground">
                  {postedEntries.length} posted · {pendingEntries.length}{" "}
                  upcoming · {asset.depreciationSchedule.length} total
                </span>
              }
            >
              {/* Desktop table */}
              <div className="hidden -mx-4 -mb-4 overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/30 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2">Period</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2 text-right">Accumulated</th>
                      <th className="px-4 py-2 text-right">Book Value</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">JE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {displaySchedule.map((s, i) => {
                      const isPosted = s.status === "posted";
                      const isCurrent = s.period === currentPeriod;
                      return (
                        <tr
                          key={`${s.period}-${i}`}
                          className={
                            isCurrent ? "bg-primary/5" : "hover:bg-muted/30"
                          }
                        >
                          <td className="px-4 py-2 font-mono text-xs">
                            {s.period}
                            {isCurrent && (
                              <span className="ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                Current
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {formatCurrency(s.depreciationAmount)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                            {formatCurrency(s.accumulatedDepreciation)}
                          </td>
                          <td className="px-4 py-2 text-right font-medium tabular-nums">
                            {formatCurrency(s.bookValue)}
                          </td>
                          <td className="px-4 py-2">
                            {isPosted ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400">
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
                          <td className="px-4 py-2">
                            {s.journalEntryId ? (
                              <Link
                                href={`/dashboard/journal/${s.journalEntryId}`}
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                View
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="-mx-4 -mb-4 divide-y divide-border md:hidden">
                {displaySchedule.map((s, i) => {
                  const isPosted = s.status === "posted";
                  const isCurrent = s.period === currentPeriod;
                  return (
                    <li
                      key={`${s.period}-${i}`}
                      className={`px-4 py-3 ${
                        isCurrent ? "bg-primary/5" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{s.period}</span>
                          {isCurrent && (
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              Current
                            </span>
                          )}
                        </div>
                        {isPosted ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Posted
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {s.status === "skipped" ? "Skipped" : "Pending"}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Amount</p>
                          <p className="font-medium tabular-nums">
                            {formatCurrency(s.depreciationAmount)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Accumulated</p>
                          <p className="font-medium tabular-nums">
                            {formatCurrency(s.accumulatedDepreciation)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Book Value</p>
                          <p className="font-medium tabular-nums">
                            {formatCurrency(s.bookValue)}
                          </p>
                        </div>
                      </div>
                      {s.journalEntryId && (
                        <Link
                          href={`/dashboard/journal/${s.journalEntryId}`}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          View journal entry
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </TabsContent>

        {/* EXPENSES TAB */}
        <TabsContent value="expenses">
          <Section
            icon={Receipt}
            title="Expense History"
            action={
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Total
                </p>
                <p className="text-sm font-semibold tabular-nums">
                  KES {formatCurrency(expenseTotal)}
                </p>
              </div>
            }
          >
            {expenseEntries.length === 0 ? (
              <p className="rounded-md bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
                No expenses tagged to this asset yet. Tag bill lines or
                expenses to this asset to track maintenance, repairs, fuel,
                and running costs.
              </p>
            ) : (
              <>
                {/* Desktop */}
                <div className="hidden -mx-4 -mb-4 overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-y border-border bg-muted/30 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2">Date</th>
                        <th className="px-4 py-2">Source</th>
                        <th className="px-4 py-2">Ref #</th>
                        <th className="px-4 py-2">Vendor</th>
                        <th className="px-4 py-2">Description</th>
                        <th className="px-4 py-2">Account</th>
                        <th className="px-4 py-2 text-right">Amount</th>
                        <th className="w-px px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {expenseEntries.map((e) => {
                        const isExpense = e.source === "expense";
                        const targetHref = isExpense
                          ? `/dashboard/expenses/${e.expenseId || e.billId}`
                          : `/dashboard/bills/${e.billId}`;
                        return (
                          <tr
                            key={`${e.source}-${e.billId}-${e.lineDescription}-${e.amount}`}
                            className="hover:bg-muted/30"
                          >
                            <td className="px-4 py-2 text-muted-foreground">
                              {formatDate(e.billDate)}
                            </td>
                            <td className="px-4 py-2">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                                  isExpense
                                    ? "bg-purple-500/10 text-purple-700 ring-purple-500/20 dark:text-purple-400"
                                    : "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400"
                                }`}
                              >
                                {isExpense ? "Expense" : "Bill"}
                              </span>
                            </td>
                            <td className="px-4 py-2 font-mono text-xs">
                              {e.billNumber}
                            </td>
                            <td className="px-4 py-2">{e.supplierName}</td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {e.lineDescription}
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">
                              <span className="font-mono">
                                {e.accountCode}
                              </span>{" "}
                              {e.accountName}
                            </td>
                            <td className="px-4 py-2 text-right font-medium tabular-nums">
                              {formatCurrency(e.amount)}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <Link
                                href={targetHref}
                                className="inline-flex items-center text-muted-foreground hover:text-foreground"
                                aria-label={
                                  isExpense ? "View expense" : "View bill"
                                }
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile */}
                <ul className="-mx-4 -mb-4 divide-y divide-border md:hidden">
                  {expenseEntries.map((e) => {
                    const isExpense = e.source === "expense";
                    const targetHref = isExpense
                      ? `/dashboard/expenses/${e.expenseId || e.billId}`
                      : `/dashboard/bills/${e.billId}`;
                    return (
                      <li
                        key={`${e.source}-${e.billId}-${e.lineDescription}-${e.amount}`}
                        className="px-4 py-3"
                      >
                        <Link href={targetHref} className="block">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {e.supplierName}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {e.lineDescription}
                              </p>
                            </div>
                            <p className="shrink-0 text-sm font-semibold tabular-nums">
                              {formatCurrency(e.amount)}
                            </p>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <span
                                className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-medium ring-1 ring-inset ${
                                  isExpense
                                    ? "bg-purple-500/10 text-purple-700 ring-purple-500/20 dark:text-purple-400"
                                    : "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400"
                                }`}
                              >
                                {isExpense ? "EXP" : "BILL"}
                              </span>
                              <span className="font-mono">{e.billNumber}</span>
                            </span>
                            <span>{formatDate(e.billDate)}</span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Section>
        </TabsContent>

        {/* ACTIVITY TAB */}
        <TabsContent value="activity" className="space-y-4">
          {!hasTransfers && !hasImpairments && !hasJournalEntries && (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <History className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No activity recorded yet.
              </p>
            </div>
          )}

          {hasTransfers && (
            <Section icon={ArrowRightLeft} title="Transfer History">
              <ul className="-mx-4 -mb-4 divide-y divide-border">
                {[...asset.transfers].reverse().map((t) => (
                  <li key={t._id} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {formatDate(t.transferredAt)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        by {t.transferredBy?.name || "—"}
                      </p>
                    </div>
                    <div className="mt-1 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
                      {(t.fromLocation || t.toLocation) && (
                        <div>
                          <span className="text-muted-foreground">
                            Location:{" "}
                          </span>
                          <span>{t.fromLocation || "—"}</span>
                          <span className="mx-1 text-muted-foreground">→</span>
                          <span className="font-medium">
                            {t.toLocation || "—"}
                          </span>
                        </div>
                      )}
                      {(t.fromDepartment || t.toDepartment) && (
                        <div>
                          <span className="text-muted-foreground">Dept: </span>
                          <span>{t.fromDepartment || "—"}</span>
                          <span className="mx-1 text-muted-foreground">→</span>
                          <span className="font-medium">
                            {t.toDepartment || "—"}
                          </span>
                        </div>
                      )}
                      {(t.fromAssignedToName || t.toAssignedToName) && (
                        <div>
                          <span className="text-muted-foreground">
                            Custodian:{" "}
                          </span>
                          <span>{t.fromAssignedToName || "—"}</span>
                          <span className="mx-1 text-muted-foreground">→</span>
                          <span className="font-medium">
                            {t.toAssignedToName || "—"}
                          </span>
                        </div>
                      )}
                    </div>
                    {t.reason && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {t.reason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {hasImpairments && (
            <Section icon={History} title="Impairment History">
              <ul className="-mx-4 -mb-4 divide-y divide-border">
                {[...asset.impairments].reverse().map((im) => (
                  <li key={im._id} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {formatDate(im.impairedAt)}
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-red-700 dark:text-red-400">
                        − KES {formatCurrency(im.amount)}
                      </p>
                    </div>
                    <p className="mt-1">{im.reason}</p>
                    <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span>by {im.impairedBy?.name || "—"}</span>
                      {im.journalEntryId && (
                        <Link
                          href={`/dashboard/journal/${im.journalEntryId}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          View JE
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {hasJournalEntries && (
            <Section icon={FileText} title="Related Journal Entries">
              <ul className="-mx-4 -mb-4 divide-y divide-border">
                {asset.journalEntryIds.map((jeId) => (
                  <li key={jeId}>
                    <Link
                      href={`/dashboard/journal/${jeId}`}
                      className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40"
                    >
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {jeId}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

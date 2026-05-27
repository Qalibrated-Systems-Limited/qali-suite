import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeFinanceNav } from "@/lib/permissions";
import Link from "next/link";
import {
  Package,
  Plus,
  Truck,
  Laptop,
  Wrench,
  Sofa,
  Building2,
  MapPin,
  Cog,
  TrendingDown,
  TrendingUp,
  Layers,
  Search,
  ChevronRight,
  Activity,
  Printer,
  Hammer,
} from "lucide-react";
import {
  getAssets,
  getAssetsTotals,
} from "@/app/mongodb/actions/asset-actions";
import PostDepreciationDialog from "@/app/dashboard/assets/components/PostDepreciationDialog";

export const metadata = { title: "Fixed Assets" };

// VIEW_ROLES is no longer hand-maintained — the page now uses
// canSeeFinanceNav() so it stays in sync with the sidebar. The Fixed
// Assets sidebar entry lives under Finance and is gated by that helper,
// so CFO and Finance Manager (previously bounced) now get through.
// ADMIN_ROLES still gates capital actions (post depreciation etc).
const ADMIN_ROLES = ["SuperAdmin", "Admin", "Accountant"];

const CATEGORY_OPTIONS = [
  { value: "", label: "All Categories" },
  { value: "land", label: "Land" },
  { value: "building", label: "Building" },
  { value: "leasehold_improvement", label: "Leasehold Improvement" },
  { value: "vehicle", label: "Vehicle" },
  { value: "machinery", label: "Plant & Machinery" },
  { value: "office_equipment", label: "Office Equipment" },
  { value: "computer", label: "Computer Equipment" },
  { value: "furniture", label: "Furniture & Fittings" },
  { value: "equipment", label: "Tools & Equipment" },
  { value: "other", label: "Other" },
];

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "idle", label: "Idle" },
  { value: "in_maintenance", label: "Maintenance" },
  { value: "disposed", label: "Disposed" },
  { value: "written_off", label: "Written Off" },
];

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

function CategoryBadge({ category }) {
  const Icon = CATEGORY_ICONS[category] || Package;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" />
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

function StatTile({ icon: Icon, label, value, accent }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 sm:px-4">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
          accent || "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-base font-semibold text-foreground sm:text-lg">
          {value}
        </p>
      </div>
    </div>
  );
}

function StatsCards({ totals }) {
  const summary = (totals || []).reduce(
    (acc, t) => {
      acc.count += t.count || 0;
      acc.totalCost += t.totalCost || 0;
      acc.totalAccumulatedDep += t.totalAccumulatedDep || 0;
      acc.totalBookValue += t.totalBookValue || 0;
      return acc;
    },
    { count: 0, totalCost: 0, totalAccumulatedDep: 0, totalBookValue: 0 }
  );

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      <StatTile
        icon={Layers}
        label="Total Assets"
        value={summary.count.toLocaleString()}
      />
      <StatTile
        icon={TrendingUp}
        label="Cost"
        value={`KES ${formatCompact(summary.totalCost)}`}
      />
      <StatTile
        icon={TrendingDown}
        label="Accum. Dep"
        value={`KES ${formatCompact(summary.totalAccumulatedDep)}`}
      />
      <StatTile
        icon={Layers}
        label="Book Value"
        value={`KES ${formatCompact(summary.totalBookValue)}`}
        accent="bg-primary/10 text-primary"
      />
    </div>
  );
}

async function AssetStats() {
  const totalsResult = await getAssetsTotals();
  return <StatsCards totals={totalsResult.totals} />;
}

function buildHref(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) search.set(k, v);
  });
  const qs = search.toString();
  return qs ? `?${qs}` : "?";
}

function StatusTabs({ activeStatus, search, category }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <div className="flex min-w-max gap-1 border-b border-border px-4 sm:px-0">
        {STATUS_TABS.map((tab) => {
          const isActive = (activeStatus || "") === tab.value;
          return (
            <Link
              key={tab.value || "all"}
              href={buildHref({ status: tab.value, search, category })}
              className={`relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {isActive && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function FilterBar({ search, category, status }) {
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      action="/dashboard/assets"
      method="get"
    >
      <input type="hidden" name="status" value={status || ""} />
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search assets, asset #, serial, registration..."
          className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div className="flex gap-2">
        <select
          name="category"
          defaultValue={category}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 sm:flex-none"
        >
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Filter
        </button>
      </div>
    </form>
  );
}

async function AssetList({ page, status, category, search }) {
  const limit = 20;

  const result = await getAssets({ page, limit, status, category, search });

  const assets = result.assets || [];
  const total = result.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;

  const serialized = assets.map((a) => ({
    _id: a._id?.toString?.() ?? a._id,
    assetNumber: a.assetNumber,
    name: a.name,
    category: a.category,
    status: a.status,
    acquisitionDate:
      a.acquisitionDate?.toISOString?.() ?? a.acquisitionDate ?? null,
    acquisitionCost: a.acquisitionCost,
    accumulatedDepreciation: a.accumulatedDepreciation || 0,
    bookValue: a.bookValue || 0,
    location: a.location || "",
    department: a.department || "",
    registrationNumber: a.registrationNumber || "",
  }));

  if (serialized.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
        <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="font-medium text-foreground">
          {status || category || search
            ? "No assets match your filters."
            : "No assets yet."}
        </p>
        {!status && !category && !search && (
          <Link
            href="/dashboard/assets/create"
            className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Add your first asset
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5">Asset</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5">Acquired</th>
              <th className="px-4 py-2.5 text-right">Cost</th>
              <th className="px-4 py-2.5 text-right">Book Value</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="w-px px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {serialized.map((asset) => (
              <tr
                key={asset._id}
                className="group transition-colors hover:bg-muted/40"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/assets/${asset._id}`}
                    className="block"
                  >
                    <p className="font-medium text-foreground group-hover:text-primary">
                      {asset.name}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                      <span>{asset.assetNumber}</span>
                      {asset.location && (
                        <>
                          <span>·</span>
                          <span className="truncate font-sans">
                            {asset.location}
                          </span>
                        </>
                      )}
                    </p>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <CategoryBadge category={asset.category} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDate(asset.acquisitionDate)}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                  {formatCurrency(asset.acquisitionCost)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {formatCurrency(asset.bookValue)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={asset.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/dashboard/assets/${asset._id}`}
                    className="inline-flex items-center text-muted-foreground hover:text-foreground"
                    aria-label={`View ${asset.name}`}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      <ul className="divide-y divide-border md:hidden">
        {serialized.map((asset) => (
          <li key={asset._id}>
            <Link
              href={`/dashboard/assets/${asset._id}`}
              className="flex items-start gap-3 p-3 transition-colors active:bg-muted/60"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-medium text-foreground">
                    {asset.name}
                  </p>
                  <StatusBadge status={asset.status} />
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {asset.assetNumber}
                  {asset.registrationNumber
                    ? ` · ${asset.registrationNumber}`
                    : ""}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <CategoryBadge category={asset.category} />
                  <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
                    <span className="text-xs text-muted-foreground">BV</span>
                    <span className="text-sm font-semibold text-foreground">
                      {formatCompact(asset.bookValue)}
                    </span>
                  </div>
                </div>
                {asset.location && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    <MapPin className="mr-1 inline h-3 w-3" />
                    {asset.location}
                  </p>
                )}
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-2.5 text-xs">
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">
              {(page - 1) * limit + 1}–{Math.min(page * limit, total)}
            </span>{" "}
            of {total}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildHref({
                  page: String(page - 1),
                  status,
                  category,
                  search,
                })}
                className="rounded-md border border-border bg-background px-2.5 py-1 font-medium hover:bg-accent hover:text-accent-foreground"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={buildHref({
                  page: String(page + 1),
                  status,
                  category,
                  search,
                })}
                className="rounded-md border border-border bg-background px-2.5 py-1 font-medium hover:bg-accent hover:text-accent-foreground"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default async function AssetsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeFinanceNav(session.user.role)) {
    redirect("/dashboard");
  }

  const canAdmin =
    ADMIN_ROLES.includes(session.user.role) ||
    session.user.role === "SuperAdmin";

  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);
  const status = params.status || "";
  const category = params.category || "";
  const search = params.search || "";

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-4 sm:px-6 sm:py-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground sm:text-xl">
            <Layers className="h-5 w-5 text-muted-foreground" />
            Fixed Assets
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            Manage assets, depreciation, and disposals
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/dashboard/assets/insights"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Insights</span>
          </Link>
          {canAdmin && <PostDepreciationDialog />}
          {canAdmin && (
            <Link
              href="/dashboard/assets/create"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New asset</span>
            </Link>
          )}
        </div>
      </header>

      {/* Stats */}
      <Suspense
        fallback={
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg border border-border bg-muted"
              />
            ))}
          </div>
        }
      >
        <AssetStats />
      </Suspense>

      {/* Status tabs */}
      <StatusTabs activeStatus={status} search={search} category={category} />

      {/* Filter + List */}
      <div className="space-y-3">
        <FilterBar search={search} category={category} status={status} />
        <Suspense
          fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}
        >
          <AssetList
            page={page}
            status={status}
            category={category}
            search={search}
          />
        </Suspense>
      </div>
    </div>
  );
}

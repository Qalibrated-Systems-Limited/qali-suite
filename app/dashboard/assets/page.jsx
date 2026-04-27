import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
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
  DollarSign,
  TrendingDown,
  TrendingUp,
  Layers,
} from "lucide-react";
import { getAssets, getAssetsTotals } from "@/app/mongodb/actions/asset-actions";
import PostDepreciationDialog from "@/app/dashboard/assets/components/PostDepreciationDialog";

export const metadata = { title: "Fixed Assets" };

const VIEW_ROLES = ["Admin", "Accountant", "Manager"];
const ADMIN_ROLES = ["Admin", "Accountant"];

const CATEGORY_OPTIONS = [
  { value: "", label: "All Categories" },
  { value: "vehicle", label: "Vehicle" },
  { value: "equipment", label: "Equipment" },
  { value: "computer", label: "Computer" },
  { value: "furniture", label: "Furniture" },
  { value: "building", label: "Building" },
  { value: "land", label: "Land" },
  { value: "machinery", label: "Machinery" },
  { value: "other", label: "Other" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "idle", label: "Idle" },
  { value: "in_maintenance", label: "In Maintenance" },
  { value: "disposed", label: "Disposed" },
  { value: "written_off", label: "Written Off" },
];

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
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        map[status] || "bg-muted text-muted-foreground"
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

function CategoryBadge({ category }) {
  const Icon = CATEGORY_ICONS[category] || Package;
  const labels = {
    vehicle: "Vehicle",
    equipment: "Equipment",
    computer: "Computer",
    furniture: "Furniture",
    building: "Building",
    land: "Land",
    machinery: "Machinery",
    other: "Other",
  };
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Icon className="h-3 w-3" />
      {labels[category] || category}
    </span>
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Layers className="h-4 w-4" />
          <p className="text-xs font-medium uppercase tracking-wide">Total Assets</p>
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">{summary.count}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <DollarSign className="h-4 w-4" />
          <p className="text-xs font-medium uppercase tracking-wide">Acquisition Cost</p>
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">
          KES {formatCurrency(summary.totalCost)}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <TrendingDown className="h-4 w-4" />
          <p className="text-xs font-medium uppercase tracking-wide">Accumulated Dep</p>
        </div>
        <p className="mt-2 text-2xl font-bold text-foreground">
          KES {formatCurrency(summary.totalAccumulatedDep)}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <TrendingUp className="h-4 w-4" />
          <p className="text-xs font-medium uppercase tracking-wide">Net Book Value</p>
        </div>
        <p className="mt-2 text-2xl font-bold text-primary">
          KES {formatCurrency(summary.totalBookValue)}
        </p>
      </div>
    </div>
  );
}

async function AssetStats() {
  const totalsResult = await getAssetsTotals();
  return <StatsCards totals={totalsResult.totals} />;
}

function FilterForm({ search, category, status }) {
  return (
    <form className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:grid-cols-[1fr_auto_auto_auto]">
      <input
        type="text"
        name="search"
        defaultValue={search}
        placeholder="Search by asset #, name, serial number..."
        className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <select
        name="category"
        defaultValue={category}
        className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {CATEGORY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        name="status"
        defaultValue={status}
        className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
      >
        Filter
      </button>
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
    acquisitionDate: a.acquisitionDate?.toISOString?.() ?? a.acquisitionDate ?? null,
    acquisitionCost: a.acquisitionCost,
    accumulatedDepreciation: a.accumulatedDepreciation || 0,
    bookValue: a.bookValue || 0,
    location: a.location || "",
    department: a.department || "",
    registrationNumber: a.registrationNumber || "",
  }));

  return (
    <>
      {serialized.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
          <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">
            {status || category || search ? "No assets match your filters." : "No assets yet."}
          </p>
          {!status && !category && !search && (
            <Link
              href="/dashboard/assets/create"
              className="mt-3 inline-block text-sm text-primary hover:underline"
            >
              Add your first asset &rarr;
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Asset #</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Acquisition Date</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3 text-right">Book Value</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {serialized.map((asset) => (
                  <tr key={asset._id} className="transition-colors hover:bg-muted/50">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {asset.assetNumber}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{asset.name}</p>
                      {asset.location && (
                        <p className="text-xs text-muted-foreground">{asset.location}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <CategoryBadge category={asset.category} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(asset.acquisitionDate)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">
                      KES {formatCurrency(asset.acquisitionCost)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      KES {formatCurrency(asset.bookValue)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={asset.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/assets/${asset._id}`}
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

          {/* Mobile cards */}
          <div className="divide-y divide-border md:hidden">
            {serialized.map((asset) => (
              <Link
                key={asset._id}
                href={`/dashboard/assets/${asset._id}`}
                className="block p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">{asset.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {asset.assetNumber}
                    </p>
                  </div>
                  <StatusBadge status={asset.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CategoryBadge category={asset.category} />
                  <span className="text-xs text-muted-foreground">
                    KES {formatCurrency(asset.acquisitionCost)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    BV: KES {formatCurrency(asset.bookValue)}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
              <p className="text-muted-foreground">{total} assets</p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`?page=${page - 1}&status=${status}&category=${category}&search=${search}`}
                    className="rounded border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground"
                  >
                    Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`?page=${page + 1}&status=${status}&category=${category}&search=${search}`}
                    className="rounded border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground"
                  >
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default async function AssetsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!VIEW_ROLES.includes(session.user.role) && session.user.role !== "SuperAdmin") {
    redirect("/dashboard");
  }

  const canAdmin =
    ADMIN_ROLES.includes(session.user.role) || session.user.role === "SuperAdmin";

  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);
  const status = params.status || "";
  const category = params.category || "";
  const search = params.search || "";

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Fixed Assets</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Manage assets, depreciation, and disposals
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canAdmin && <PostDepreciationDialog />}
          {canAdmin && (
            <Link
              href="/dashboard/assets/create"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add Asset</span>
              <span className="sm:hidden">New</span>
            </Link>
          )}
        </div>
      </div>

      <Suspense
        fallback={
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-lg border border-border bg-muted"
              />
            ))}
          </div>
        }
      >
        <AssetStats />
      </Suspense>

      <FilterForm search={search} category={category} status={status} />

      <Suspense
        fallback={
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        }
      >
        <AssetList page={page} status={status} category={category} search={search} />
      </Suspense>
    </div>
  );
}

import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Layers,
  TrendingUp,
  Truck,
  Laptop,
  Wrench,
  Sofa,
  Building2,
  MapPin,
  Cog,
  Package,
  Printer,
  Hammer,
} from "lucide-react";
import {
  loadFleetAssetCount,
  loadFleetInsights,
} from "@/app/mongodb/queries/fleet-insights-queries";

export const metadata = {
  title: "Fleet Insights | Fixed Assets",
  description: "Running-cost analytics across the fleet",
};

const VIEW_ROLES = ["SuperAdmin", "Admin", "CEO", "CFO", "Finance Manager", "Accountant", "Manager"];

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
  building: "Buildings",
  leasehold_improvement: "Leasehold Improvements",
  vehicle: "Vehicles",
  machinery: "Plant & Machinery",
  office_equipment: "Office Equipment",
  computer: "Computer Equipment",
  furniture: "Furniture & Fittings",
  equipment: "Tools & Equipment",
  other: "Other",
};

// Watchlist tabs are scoped to the categories where running-cost analytics
// matter most (movable assets that consume fuel/parts/maintenance).
const CATEGORY_TABS = [
  { value: "", label: "All" },
  { value: "vehicle", label: "Vehicles" },
  { value: "machinery", label: "Plant & Machinery" },
  { value: "office_equipment", label: "Office Equipment" },
  { value: "computer", label: "Computers" },
  { value: "equipment", label: "Tools" },
];

const SORT_OPTIONS = [
  { value: "spend_desc", label: "Highest spend" },
  { value: "ratio_desc", label: "Worst peer ratio" },
  { value: "cost_per_unit_desc", label: "Highest cost / unit" },
  { value: "stale_readings", label: "Stale readings" },
  { value: "spend_pct_book_desc", label: "Spend vs book value" },
];

const HEALTH_STYLES = {
  healthy: {
    label: "Healthy",
    pill:
      "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
  },
  watch: {
    label: "Watch",
    pill:
      "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
  },
  high: {
    label: "High",
    pill: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
  },
};

function formatCurrency(amount) {
  return (amount || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function formatCompact(amount) {
  const n = amount || 0;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function HealthPill({ level }) {
  const cfg = HEALTH_STYLES[level] || HEALTH_STYLES.healthy;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.pill}`}
    >
      {cfg.label}
    </span>
  );
}

function buildHref(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) search.set(k, v);
  });
  const qs = search.toString();
  return qs ? `?${qs}` : "?";
}

function applySort(rows, sort) {
  const copy = [...rows];
  switch (sort) {
    case "ratio_desc":
      return copy.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
    case "cost_per_unit_desc":
      return copy.sort(
        (a, b) => (b.costPerUnit ?? 0) - (a.costPerUnit ?? 0),
      );
    case "stale_readings":
      return copy.sort(
        (a, b) =>
          (b.daysSinceReading ?? Number.POSITIVE_INFINITY) -
          (a.daysSinceReading ?? Number.POSITIVE_INFINITY),
      );
    case "spend_pct_book_desc":
      return copy.sort(
        (a, b) => (b.totalPctOfBook ?? 0) - (a.totalPctOfBook ?? 0),
      );
    case "spend_desc":
    default:
      return copy.sort((a, b) => b.trailing12Total - a.trailing12Total);
  }
}

// ============================================
// CARD SHELL + SKELETON
// ============================================
// Stat tiles render in two phases: skeleton (shown while async data loads),
// then the resolved tile. Wrapping each tile in its own <Suspense> means
// each one streams in independently; React renders the static page shell
// first and replaces skeletons in place as data arrives.
function StatTileShell({ icon: Icon, label, children, tone, hint }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div
        className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wide ${
          tone === "warn"
            ? "text-amber-600 dark:text-amber-400"
            : tone === "bad"
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground"
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 truncate text-base font-semibold sm:text-lg">
        {children}
      </p>
      {hint && (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function StatTileSkeleton({ icon: Icon, label }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 h-5 w-20 animate-pulse rounded bg-muted" />
      <div className="mt-1 h-3 w-16 animate-pulse rounded bg-muted/60" />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>
      <ul className="divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center justify-between gap-3 p-3">
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
            </div>
            <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================
// ASYNC CARD COMPONENTS
// ============================================
// Each one fetches its own slice. The cheap one (TotalAssetsCard) calls a
// dedicated countDocuments query. The other three call the heavy
// loadFleetInsights() — but it's wrapped in React.cache(), so all three
// share a single in-flight aggregation per request.

async function TotalAssetsCard({ category }) {
  const result = await loadFleetAssetCount(category);
  return (
    <StatTileShell
      icon={Layers}
      label="Tracked assets"
      hint={
        category
          ? `Filtered: ${CATEGORY_LABELS[category] || category}`
          : "Active + idle + maintenance"
      }
    >
      {result.success ? result.count.toLocaleString() : "—"}
    </StatTileShell>
  );
}

async function TotalSpendCard({ category }) {
  const result = await loadFleetInsights(category);
  const total = result.summary?.totalSpend || 0;
  return (
    <StatTileShell icon={TrendingUp} label="12mo spend">
      KES {formatCompact(total)}
    </StatTileShell>
  );
}

async function FlaggedCard({ category }) {
  const result = await loadFleetInsights(category);
  const flagged = result.summary?.flagged || 0;
  return (
    <StatTileShell
      icon={AlertTriangle}
      label="Flagged"
      hint="Watch + High"
      tone={flagged > 0 ? "warn" : undefined}
    >
      {flagged.toLocaleString()}
    </StatTileShell>
  );
}

async function StaleReadingsCard({ category }) {
  const result = await loadFleetInsights(category);
  const stale = result.summary?.missingReadings || 0;
  return (
    <StatTileShell
      icon={Gauge}
      label="Stale readings"
      hint=">60 days or never"
      tone={stale > 0 ? "warn" : undefined}
    >
      {stale.toLocaleString()}
    </StatTileShell>
  );
}

async function Watchlist({ category, sort }) {
  const result = await loadFleetInsights(category);

  if (!result.success) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {result.error || "Failed to load watchlist"}
      </div>
    );
  }

  const rows = applySort(result.rows, sort);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
        <Activity className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="font-medium text-foreground">No assets to analyze</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add active fixed assets and tag bills/expenses to them to get
          running-cost insights.
        </p>
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
              <th className="px-4 py-2.5">Health</th>
              <th className="px-4 py-2.5 text-right">12mo spend</th>
              <th className="px-4 py-2.5 text-right">Cost / unit</th>
              <th className="px-4 py-2.5 text-right">Peer ratio</th>
              <th className="px-4 py-2.5 text-right">% of book</th>
              <th className="px-4 py-2.5">Last reading</th>
              <th className="w-px px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const Icon = CATEGORY_ICONS[r.category] || Package;
              return (
                <tr
                  key={r._id}
                  className="group transition-colors hover:bg-muted/40"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/assets/${r._id}?tab=costs`}
                      className="block"
                    >
                      <p className="flex items-center gap-2 font-medium text-foreground group-hover:text-primary">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        {r.name}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {r.assetNumber}
                        {r.registrationNumber
                          ? ` · ${r.registrationNumber}`
                          : ""}
                      </p>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <HealthPill level={r.health} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {r.trailing12Total > 0
                      ? formatCurrency(r.trailing12Total)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {r.costPerUnit !== null ? (
                      <>
                        {r.costPerUnit.toLocaleString("en-KE", {
                          maximumFractionDigits: 1,
                        })}
                        <span className="ml-1 text-[10px]">
                          /{r.usageUnit}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.ratio !== null ? (
                      <span
                        className={
                          r.ratio > 1.5
                            ? "text-red-600 dark:text-red-400"
                            : r.ratio > 1.0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                        }
                      >
                        {r.ratio.toFixed(2)}×
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.totalPctOfBook !== null ? (
                      <span
                        className={
                          r.totalPctOfBook > 100
                            ? "text-red-600 dark:text-red-400"
                            : r.totalPctOfBook > 50
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                        }
                      >
                        {r.totalPctOfBook.toFixed(0)}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {r.daysSinceReading === null ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        Never
                      </span>
                    ) : r.daysSinceReading > 60 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {r.daysSinceReading}d ago
                      </span>
                    ) : (
                      <span>{r.daysSinceReading}d ago</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/assets/${r._id}?tab=costs`}
                      className="inline-flex items-center text-muted-foreground hover:text-foreground"
                      aria-label={`View ${r.name}`}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((r) => {
          const Icon = CATEGORY_ICONS[r.category] || Package;
          return (
            <li key={r._id}>
              <Link
                href={`/dashboard/assets/${r._id}?tab=costs`}
                className="block p-3 active:bg-muted/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium text-foreground">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{r.name}</span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {r.assetNumber}
                      {r.registrationNumber
                        ? ` · ${r.registrationNumber}`
                        : ""}
                    </p>
                  </div>
                  <HealthPill level={r.health} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">12mo</p>
                    <p className="font-semibold tabular-nums">
                      {r.trailing12Total > 0
                        ? formatCompact(r.trailing12Total)
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">/{r.usageUnit}</p>
                    <p className="font-semibold tabular-nums">
                      {r.costPerUnit !== null
                        ? r.costPerUnit.toLocaleString("en-KE", {
                            maximumFractionDigits: 1,
                          })
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">vs peers</p>
                    <p
                      className={`font-semibold tabular-nums ${
                        r.ratio === null
                          ? ""
                          : r.ratio > 1.5
                            ? "text-red-600 dark:text-red-400"
                            : r.ratio > 1.0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {r.ratio !== null ? `${r.ratio.toFixed(2)}×` : "—"}
                    </p>
                  </div>
                </div>
                {(r.daysSinceReading === null ||
                  r.daysSinceReading > 60) && (
                  <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400">
                    <Gauge className="h-3 w-3" />
                    {r.daysSinceReading === null
                      ? "No reading logged"
                      : `Last reading ${r.daysSinceReading}d ago`}
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================
// STATIC UI (renders immediately, never suspends)
// ============================================
function CategoryTabs({ activeCategory, sort }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <div className="flex min-w-max gap-1 border-b border-border px-4 sm:px-0">
        {CATEGORY_TABS.map((tab) => {
          const isActive = (activeCategory || "") === tab.value;
          return (
            <Link
              key={tab.value || "all"}
              href={buildHref({ category: tab.value, sort })}
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

function SortBar({ category, sort }) {
  return (
    <form
      method="get"
      className="flex items-center gap-2 text-xs"
      action="/dashboard/assets/insights"
    >
      <input type="hidden" name="category" value={category || ""} />
      <label
        htmlFor="sort"
        className="font-medium uppercase tracking-wide text-muted-foreground"
      >
        Sort
      </label>
      <select
        id="sort"
        name="sort"
        defaultValue={sort}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {SORT_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="ml-1 inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
      >
        Apply
      </button>
    </form>
  );
}

// ============================================
// PAGE
// ============================================
export default async function FleetInsightsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (
    !VIEW_ROLES.includes(session.user.role) &&
    session.user.role !== "SuperAdmin"
  ) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const category = params.category || "";
  const sort = params.sort || "spend_desc";

  // Cards depend only on category — keep their boundary stable across sort
  // changes so they don't flash a skeleton when only the watchlist re-orders.
  // Watchlist depends on both.
  const cardKey = category || "all";
  const listKey = `${cardKey}|${sort}`;

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-4 sm:px-6 sm:py-6">
      {/* Static breadcrumb — never blocks */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          href="/dashboard/assets"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Assets
        </Link>
        <span>/</span>
        <span className="text-foreground">Insights</span>
      </nav>

      {/* Static header — never blocks */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground sm:text-xl">
            <Activity className="h-5 w-5 text-muted-foreground" />
            Fleet running-cost insights
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            Trailing 12-month spend, peer comparisons, and cost-per-unit
            tracking across active assets.
          </p>
        </div>
      </header>

      {/* Static category tabs — never blocks */}
      <CategoryTabs activeCategory={category} sort={sort} />

      {/* Stat cards — each in its own Suspense, streams independently */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Suspense
          key={`assets|${cardKey}`}
          fallback={<StatTileSkeleton icon={Layers} label="Tracked assets" />}
        >
          <TotalAssetsCard category={category} />
        </Suspense>
        <Suspense
          key={`spend|${cardKey}`}
          fallback={<StatTileSkeleton icon={TrendingUp} label="12mo spend" />}
        >
          <TotalSpendCard category={category} />
        </Suspense>
        <Suspense
          key={`flagged|${cardKey}`}
          fallback={<StatTileSkeleton icon={AlertTriangle} label="Flagged" />}
        >
          <FlaggedCard category={category} />
        </Suspense>
        <Suspense
          key={`stale|${cardKey}`}
          fallback={<StatTileSkeleton icon={Gauge} label="Stale readings" />}
        >
          <StaleReadingsCard category={category} />
        </Suspense>
      </div>

      {/* Static sort bar — never blocks */}
      <SortBar category={category} sort={sort} />

      {/* Watchlist in its own Suspense */}
      <Suspense key={`watchlist|${listKey}`} fallback={<ListSkeleton />}>
        <Watchlist category={category} sort={sort} />
      </Suspense>
    </div>
  );
}

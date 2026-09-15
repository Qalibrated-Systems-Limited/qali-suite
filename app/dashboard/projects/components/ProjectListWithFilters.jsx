"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FolderKanban,
  Activity,
  PauseCircle,
  CheckCircle2,
  Clock,
  ChevronRight,
} from "lucide-react";

/**
 * The project REGISTER.
 *
 * It was a two-column grid of cards, each about 180px tall: twenty projects
 * filled six screens, and comparing two jobs' budget utilisation meant
 * scrolling between them. A register is a list you scan down one column and
 * compare across a row — which is a table, and is what every construction ERP
 * shows here. The card survives as the MOBILE row, because a six-column table
 * on a phone is worse than either.
 *
 * Nothing about the data changed. `listProjects` was already fetching the
 * actuals, the effective budget and the progress roll-up for every row in two
 * queries (see app/db/repositories/projects.ts) — the card simply drew three of
 * the numbers it was given and dropped the rest.
 */

const STATUS_CONFIG = {
  planning: { label: "Planning", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: Clock },
  active: { label: "Active", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", icon: Activity },
  on_hold: { label: "On Hold", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", icon: PauseCircle },
  completed: { label: "Completed", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", icon: CheckCircle2 },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400", icon: CheckCircle2 },
};

const PRIORITY_CONFIG = {
  low: { label: "Low", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  normal: { label: "Normal", color: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300" },
  high: { label: "High", color: "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300" },
  critical: { label: "Critical", color: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300" },
};

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

/**
 * Budget consumed — costs AND commitments, the same sum the detail page draws.
 *
 * Returns `null` rather than 0 when there is no budget: a job with no budget
 * has not used 0% of it, and a green bar at zero says the opposite of "nobody
 * has set a budget for this".
 */
function utilisation(project) {
  const budget = project.budget?.amount || 0;
  if (budget <= 0) return null;
  const used =
    (project.financials?.totalCosts || 0) +
    (project.financials?.totalCommitted || 0);
  return Math.round((used / budget) * 100);
}

function utilClass(pct) {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 90) return "text-red-600 dark:text-red-400 font-medium";
  if (pct >= 70) return "text-amber-600 dark:text-amber-400 font-medium";
  return "text-muted-foreground";
}

function barClass(pct) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

function UtilBar({ pct }) {
  if (pct === null) {
    return <span className="text-xs text-muted-foreground">No budget</span>;
  }
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="hidden lg:block w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barClass(pct)}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums ${utilClass(pct)}`}>{pct}%</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.planning;
  const Icon = cfg.icon;
  return (
    <Badge variant="secondary" className={`text-xs whitespace-nowrap ${cfg.color}`}>
      <Icon className="h-3 w-3 mr-1" />
      {cfg.label}
    </Badge>
  );
}

// ── Desktop: one row per project ────────────────────────────────────────────
function ProjectRow({ project }) {
  const router = useRouter();
  const href = `/dashboard/projects/${project.id}`;
  const pct = utilisation(project);
  const priorityCfg = PRIORITY_CONFIG[project.priority] || PRIORITY_CONFIG.normal;
  const progress = Number(project.progressPercent ?? 0);

  return (
    <TableRow
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={() => router.push(href)}
    >
      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
        {project.projectNumber}
      </TableCell>
      <TableCell className="max-w-[22rem]">
        {/*
          A real anchor inside the row, not just the row's onClick: a register
          is a page people middle-click, copy the link from, and tab through.
          The onClick is the convenience; this is the navigation.
        */}
        <Link
          href={href}
          className="font-medium hover:underline block truncate"
          onClick={(e) => e.stopPropagation()}
        >
          {project.name}
        </Link>
        {project.priority !== "normal" && (
          <Badge variant="secondary" className={`mt-1 text-[10px] ${priorityCfg.color}`}>
            {priorityCfg.label}
          </Badge>
        )}
      </TableCell>
      <TableCell className="hidden xl:table-cell text-sm text-muted-foreground truncate max-w-[12rem]">
        {project.client?.name || "—"}
      </TableCell>
      <TableCell className="hidden 2xl:table-cell text-sm text-muted-foreground truncate max-w-[10rem]">
        {project.projectManager?.name || "—"}
      </TableCell>
      <TableCell>
        <StatusBadge status={project.status} />
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <div className="flex items-center gap-2">
          <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {progress}%
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm whitespace-nowrap">
        {project.budget?.amount > 0
          ? formatCurrency(project.budget.amount)
          : "—"}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <UtilBar pct={pct} />
      </TableCell>
      <TableCell className="w-8">
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </TableCell>
    </TableRow>
  );
}

/**
 * THE PHONE ROW — the default, not the fallback.
 *
 * This is the layout the register is designed at; the table below is what it
 * becomes when there is room for one. A site agent opens this on a phone in a
 * yard, so: one tap target per project at 44px+, no horizontal scroll, and the
 * three things worth knowing on a small screen — where it is, how far along,
 * and whether the budget is in trouble. The client's name is the fourth, and
 * it earns its line; the manager's does not, so it waits for the table.
 *
 * `active:` rather than `hover:` — a finger has no hover state, and a card
 * that only responds to a mouse feels dead under a thumb.
 */
function ProjectRowMobile({ project }) {
  const pct = utilisation(project);
  const progress = Number(project.progressPercent ?? 0);

  return (
    <Link
      href={`/dashboard/projects/${project.id}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="p-3.5 min-h-[76px] active:bg-muted/70 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-[15px] leading-snug line-clamp-2">
              {project.name}
            </h3>
            <p className="font-mono text-[11px] text-muted-foreground mt-0.5 truncate">
              {project.projectNumber}
              {project.client?.name ? ` · ${project.client.name}` : ""}
            </p>
          </div>
          <StatusBadge status={project.status} />
        </div>

        {/*
          One bar, not two. Two progress bars stacked on a 360px screen read as
          a chart nobody asked for; the budget is the number that needs a bar,
          because "84%" only means something against its track.
        */}
        <div className="flex items-center justify-between gap-3 mt-2.5">
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {progress}% done
          </span>
          {pct === null ? (
            <span className="text-xs text-muted-foreground">No budget</span>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                <div
                  className={`h-full rounded-full ${barClass(pct)}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <span className={`text-xs tabular-nums whitespace-nowrap ${utilClass(pct)}`}>
                {pct}% of {formatCurrency(project.budget.amount)}
              </span>
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

const statusFilters = [
  { value: "all", label: "All" },
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
];

export default function ProjectListWithFilters({
  projects,
  currentStatus = "all",
  query = "",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleFilterChange = (value) => {
    const params = new URLSearchParams(searchParams);
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  const empty = projects.length === 0;

  return (
    <div className="space-y-3">
      {/*
        Status filter — A SCROLLING STRIP ON A PHONE, a grid when it fits.

        It was `grid-cols-3` below lg, so five filters became two ragged rows
        with an empty sixth cell, and the row you wanted was as likely to be
        the one underneath. Five pills that scroll sideways is one row at any
        width, and sideways scroll inside a strip is a gesture people already
        know — unlike the page body, which must never scroll sideways.
      */}
      <Tabs value={currentStatus} onValueChange={handleFilterChange}>
        <TabsList className="flex w-full justify-start overflow-x-auto gap-1.5 p-1 h-auto bg-muted sm:grid sm:grid-cols-5 sm:gap-2">
          {statusFilters.map((filter) => (
            <TabsTrigger
              key={filter.value}
              value={filter.value}
              className="shrink-0 text-sm font-medium py-2 px-3.5 min-h-[36px] data-[state=active]:bg-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-sm"
            >
              {filter.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <p className="text-sm text-muted-foreground">
        {empty ? (
          "No projects found"
        ) : (
          <>
            Showing{" "}
            <span className="font-semibold text-foreground">
              {projects.length}
            </span>{" "}
            project{projects.length !== 1 ? "s" : ""}
            {query ? (
              <>
                {" "}
                matching{" "}
                <span className="font-semibold text-foreground">
                  &ldquo;{query}&rdquo;
                </span>
              </>
            ) : null}
          </>
        )}
      </p>

      {empty ? (
        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FolderKanban className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-1.5">
            No projects found
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {query
              ? "No project matches that number, name, client or manager."
              : currentStatus !== "all"
                ? "Try adjusting your filters to see more projects"
                : "Get started by creating your first project"}
          </p>
        </div>
      ) : (
        <>
          {/* THE PHONE LIST FIRST — this is the default rendering. */}
          <div className="flex md:hidden flex-col gap-2">
            {projects.map((project) => (
              <ProjectRowMobile key={project.id} project={project} />
            ))}
          </div>

          {/* From md up it becomes the register. `overflow-x-auto` so the page
              body never scrolls sideways on a narrow desktop window. */}
          <Card className="hidden md:block overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Number</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="hidden xl:table-cell">Client</TableHead>
                  <TableHead className="hidden 2xl:table-cell">Manager</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Progress</TableHead>
                  <TableHead className="text-right whitespace-nowrap">
                    Budget (KES)
                  </TableHead>
                  <TableHead className="text-right whitespace-nowrap">
                    Used
                  </TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <ProjectRow key={project.id} project={project} />
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * The loading state, built from the SAME markup as the list above it.
 *
 * It used to be a guess at the shape: a full-width grey bar where the five
 * filter pills go, and a stack of flex rows with five bars at arbitrary widths
 * where the table goes — no header, no column alignment, and nothing that
 * moved with the breakpoint. So every load ended in a jump, and the widest
 * jump was on the desktop table, which gains a header row and three
 * conditionally-visible columns the placeholder never had.
 *
 * This renders the real `Table`, the real `TableHeader` with its real column
 * labels, and cells carrying the SAME `hidden xl:table-cell` / `2xl` /
 * `lg:table-cell` classes as `ProjectRow`. The header is real text rather than
 * a grey bar, because it is known before the data is and a column you can
 * already read is worth more than a shimmer. Widths of the bars inside each
 * cell echo what lands there: a short mono number, a long name, a badge.
 *
 * EIGHT ROWS, not the page's twenty. Twenty rows of shimmer is a wall, and the
 * only honest claim a skeleton makes is "a list is coming, and this is its
 * shape" — not "there are exactly this many".
 */
export function ProjectListSkeleton() {
  const Bar = ({ className }) => (
    <div className={`h-3.5 rounded bg-muted ${className}`} />
  );

  return (
    <div className="space-y-3">
      {/* The filter strip, pill for pill. */}
      <div className="flex w-full justify-start gap-1.5 rounded-md bg-muted p-1 sm:grid sm:grid-cols-5 sm:gap-2">
        {["All", "Planning", "Active", "On Hold", "Completed"].map((label) => (
          <div
            key={label}
            className="h-9 shrink-0 animate-pulse rounded-sm bg-muted-foreground/10 px-3.5"
            style={{ minWidth: `${label.length * 8 + 28}px` }}
          />
        ))}
      </div>

      <Bar className="h-4 w-36 animate-pulse" />

      {/* Phone: the same stack of cards the real list renders. */}
      <div className="flex flex-col gap-2 md:hidden">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i} className="min-h-[76px] animate-pulse space-y-2.5 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
              </div>
              <div className="h-5 w-16 shrink-0 rounded bg-muted" />
            </div>
            <div className="flex items-center justify-between">
              <div className="h-3 w-16 rounded bg-muted" />
              <div className="h-3 w-28 rounded bg-muted" />
            </div>
          </Card>
        ))}
      </div>

      {/* md+: the register, column for column. */}
      <Card className="hidden overflow-x-auto p-0 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Number</TableHead>
              <TableHead>Project</TableHead>
              <TableHead className="hidden xl:table-cell">Client</TableHead>
              <TableHead className="hidden 2xl:table-cell">Manager</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Progress</TableHead>
              <TableHead className="text-right whitespace-nowrap">
                Budget (KES)
              </TableHead>
              <TableHead className="text-right whitespace-nowrap">Used</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <TableRow key={i} className="animate-pulse">
                <TableCell><Bar className="h-3 w-20" /></TableCell>
                <TableCell className="max-w-[22rem]"><Bar className="w-48" /></TableCell>
                <TableCell className="hidden xl:table-cell"><Bar className="h-3 w-24" /></TableCell>
                <TableCell className="hidden 2xl:table-cell"><Bar className="h-3 w-20" /></TableCell>
                <TableCell><div className="h-5 w-20 rounded-full bg-muted" /></TableCell>
                <TableCell className="hidden lg:table-cell">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-14 rounded-full bg-muted" />
                    <Bar className="h-3 w-8" />
                  </div>
                </TableCell>
                <TableCell><Bar className="ml-auto h-3 w-20" /></TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <div className="hidden h-1.5 w-16 rounded-full bg-muted lg:block" />
                    <Bar className="h-3 w-8" />
                  </div>
                </TableCell>
                <TableCell className="w-8" />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

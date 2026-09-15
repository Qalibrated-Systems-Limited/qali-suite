import { Card } from "@/components/ui/card";
import { getProjectStats } from "@/app/db/actions/project-actions";

/**
 * The counts and the money, in ONE strip above the list.
 *
 * It was two blocks: four cards at `p-5`, each with a 40px icon tile and a
 * `text-2xl` figure, and beneath them a gradient "Active Projects Summary"
 * card with its own icon tile, its own heading and four more figures. Together
 * they took roughly 260px on a laptop before a single project appeared, and on
 * a phone they were four rows — two of counts, two of money — so the list
 * started below the fold on the page whose whole job is the list.
 *
 * WHAT WENT, and none of it was information:
 *
 *   * The icon tiles. A coloured square beside the word "Active" tells the
 *     reader nothing the word does not, and it set the height of the row.
 *   * The "Active Projects Summary" heading and its gradient — a heading over
 *     four figures that are already labelled.
 *   * The second Card. Counts and money are one glance; two surfaces made them
 *     two.
 *
 * WHAT STAYED: every figure, its label, and the colours that carry meaning —
 * revenue green, cost red, committed amber, because those three are read
 * against each other and the colour is the reading.
 *
 * The hairlines are `gap-px` over `bg-border`, not `divide-x`. On a two-column
 * grid `divide-x` gives every child but the first a left border — including
 * the first cell of the second row, which draws a stray vertical line down the
 * container's left edge. (`p-0` is safe against the Card's own `py-6`: `cn`
 * runs tailwind-merge, so the later class wins the conflict outright.)
 */

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

/** One cell. `tone` is the meaning, not decoration. */
function Figure({ label, value, tone }) {
  return (
    <div className="min-w-0 bg-card px-3 py-2.5 sm:px-4">
      <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`truncate text-base font-semibold sm:text-lg ${tone ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

const ROW = "grid grid-cols-2 gap-px bg-border sm:grid-cols-4";

export default async function ProjectStats() {
  const stats = await getProjectStats();

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className={ROW}>
        <Figure label="Projects" value={stats.total} />
        <Figure label="Active" value={stats.active} />
        <Figure label="On hold" value={stats.onHold} />
        <Figure label="Completed" value={stats.completed + stats.closed} />
      </div>

      {stats.totalBudget > 0 && (
        <div className={`mt-px ${ROW}`}>
          <Figure label="Budget" value={`KES ${formatCurrency(stats.totalBudget)}`} />
          <Figure
            label="Revenue"
            value={`KES ${formatCurrency(stats.totalRevenue)}`}
            tone="text-emerald-600 dark:text-emerald-500"
          />
          <Figure
            label="Costs"
            value={`KES ${formatCurrency(stats.totalCosts)}`}
            tone="text-red-600 dark:text-red-500"
          />
          <Figure
            label="Committed"
            value={`KES ${formatCurrency(stats.totalCommitted)}`}
            tone="text-amber-600 dark:text-amber-500"
          />
        </div>
      )}
    </Card>
  );
}

/**
 * The same shape, so the list does not jump when the figures arrive.
 *
 * Two rows, because a tenant that has budgeted anything gets two — a skeleton
 * one row shorter than its content is the layout shift it exists to prevent.
 */
export function ProjectStatsSkeleton() {
  const cell = (key) => (
    <div key={key} className="space-y-2 bg-card px-3 py-2.5 sm:px-4">
      <div className="h-3 w-14 rounded bg-muted" />
      <div className="h-5 w-16 rounded bg-muted" />
    </div>
  );

  return (
    <Card className="animate-pulse gap-0 overflow-hidden p-0">
      <div className={ROW}>{[1, 2, 3, 4].map(cell)}</div>
      <div className={`mt-px ${ROW}`}>{[5, 6, 7, 8].map(cell)}</div>
    </Card>
  );
}

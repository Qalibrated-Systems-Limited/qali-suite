import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The figures above a page, as ONE line rather than a row of cards.
 *
 * WHERE THIS CAME FROM. It is the stock page's `StockMetricsBar`, lifted here
 * unchanged in behaviour so every page can use it. That page's own note is the
 * argument for it, and it is worth repeating: four 140px cards with 2xl
 * numerals and 32px icons put roughly 300px between the heading and the first
 * row. On a list screen the LIST is the content; the summary is context, and
 * context belongs in a strip.
 *
 * A FIGURE THAT NAMES A SUBSET SHOULD BE A LINK. Pass `href` and the number
 * filters the list to the rows it counts. A count you cannot act on is
 * decoration — this is what NetSuite's saved searches, Odoo's filter bar and
 * Xero's report tiles all do. Totals and valuations are not subsets, so they
 * are not offered as links.
 *
 * MOBILE. It wraps. Four label/value pairs at `text-xs`/`text-sm` reflow to two
 * or three lines on a 360px screen, which is still far less than four stacked
 * cards — and the type never shrinks below `text-sm`, because a number too
 * small to read is not compact, it is just small.
 *
 * `tabular-nums` so digits line up between groups instead of shifting as counts
 * change.
 *
 * @param items [{ label, value, href, tone, title }]
 * @param tone  "default" | "success" | "warn" | "danger" | "muted"
 */

const TONE = {
  // The neutral case: a figure with nothing to say about itself.
  default: "text-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  warn: "text-orange-600 dark:text-orange-400",
  danger: "text-red-600 dark:text-red-400",
  // For a figure that is deliberately unremarkable — a zero that needs no
  // attention drawn to it.
  muted: "text-muted-foreground",
};

const BAR =
  "flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2 sm:gap-x-6 sm:px-4 sm:py-2.5";

export function Metric({ label, value, href, tone = "default", title }) {
  const body = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          TONE[tone] ?? TONE.default,
        )}
      >
        {/* A missing figure reads as an em dash, never as blank — the users
            page shipped four numbers that were silently undefined, and blank
            is indistinguishable from zero data. */}
        {value ?? "—"}
      </span>
    </>
  );

  if (!href) {
    return (
      <span className="flex items-baseline gap-2" title={title}>
        {body}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="flex items-baseline gap-2 rounded-sm px-1 -mx-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={title ?? `Show only ${String(label).toLowerCase()}`}
    >
      {body}
    </Link>
  );
}

export function MetricBar({ items = [], className, children }) {
  if (!items.length && !children) return null;
  return (
    <div className={cn(BAR, className)}>
      {items.map((item) => (
        <Metric key={item.label} {...item} />
      ))}
      {children}
    </div>
  );
}

/** Same box, same two line heights, so nothing shifts when the figures land. */
export function MetricBarSkeleton({ count = 4, className }) {
  return (
    <div className={cn(BAR, className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-baseline gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

export default MetricBar;

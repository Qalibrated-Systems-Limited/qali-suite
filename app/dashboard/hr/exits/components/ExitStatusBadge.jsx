const STYLES = {
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-muted text-muted-foreground",
};

const LABELS = {
  draft: "In progress",
  approved: "Awaiting payment",
  paid: "Settled",
  cancelled: "Cancelled",
};

export function ExitStatusBadge({ status }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] || "bg-muted text-muted-foreground"}`}
    >
      {LABELS[status] || status}
    </span>
  );
}

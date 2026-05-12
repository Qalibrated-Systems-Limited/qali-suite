const STATUS_STYLES = {
  draft: "bg-muted text-muted-foreground",
  pending_acceptance: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  partially_accepted: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
  voided: "bg-gray-500/15 text-gray-600 dark:text-gray-400",
};

const STATUS_LABELS = {
  draft: "Draft",
  pending_acceptance: "Pending acceptance",
  accepted: "Accepted",
  partially_accepted: "Partially accepted",
  rejected: "Rejected",
  voided: "Voided",
};

export default function GRNStatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] || STATUS_STYLES.draft
      }`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

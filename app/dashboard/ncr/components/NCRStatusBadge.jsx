const STATUS_STYLES = {
  open: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  disposition_proposed: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  authorized: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  closed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-gray-500/15 text-gray-600 dark:text-gray-400",
};

const STATUS_LABELS = {
  open: "Open",
  disposition_proposed: "Disposition proposed",
  authorized: "Authorized",
  closed: "Closed",
  cancelled: "Cancelled",
};

export default function NCRStatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] || STATUS_STYLES.open
      }`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

const CATEGORY_LABELS = {
  received_qty_variance: "Receipt quantity variance",
  received_damaged: "Damaged on receipt",
  stock_deterioration: "Stock deterioration",
  tool_damage: "Tool damage",
  stock_count_variance: "Stock count variance",
  other: "Other",
};

export function NCRCategoryLabel({ category }) {
  return (
    <span className="text-xs text-muted-foreground capitalize">
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

const DISPOSITION_LABELS = {
  pending: "Pending",
  return_to_supplier: "Return to supplier",
  repair: "Repair",
  downgrade: "Downgrade",
  scrap: "Scrap / write-off",
  accept_as_is: "Accept as-is",
};

export function DispositionLabel({ type }) {
  return DISPOSITION_LABELS[type] || type;
}

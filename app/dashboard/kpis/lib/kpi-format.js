// ============================================
// KPI display helpers
// ============================================
// Pure functions — safe to import from server or client components.
// Keep formatting decisions here so list/detail/widget render consistently.

export function formatKpiValue(value, unit) {
  if (value == null || Number.isNaN(value)) return "—";
  switch (unit) {
    case "currency":
      return new Intl.NumberFormat("en-KE", {
        style: "currency",
        currency: "KES",
        maximumFractionDigits: 0,
      }).format(value);
    case "percentage":
      return `${Number(value).toFixed(1)}%`;
    case "days":
      return `${Number(value).toFixed(0)} d`;
    case "ratio":
      return Number(value).toFixed(2);
    case "count":
    default:
      return new Intl.NumberFormat("en-KE").format(value);
  }
}

export function percentVsTarget(actual, target) {
  if (target == null || target === 0) return null;
  return (actual / target) * 100;
}

// Returns one of: "on_target" | "near_target" | "off_target"
// Default thresholds: higher-is-better → 95% green, 80% amber, below = red.
//                     lower-is-better  → 100% green, 120% amber, above = red.
// Per-KPI overrides via customThresholds (stored as ratios — 0.95 = 95%).
// Direction inverts comparison for lower-is-better KPIs.
export function kpiStatus(actual, target, direction, customThresholds = null) {
  if (target == null || target === 0) return "no-data";
  const ratio = actual / target;
  const isLowerBetter = direction === "lower_is_better";

  // Pick effective thresholds. null/undefined custom value → fall back to default.
  const defaults = isLowerBetter
    ? { onTarget: 1.0, nearTarget: 1.2 }
    : { onTarget: 0.95, nearTarget: 0.8 };
  const onT = customThresholds?.onTargetThreshold ?? defaults.onTarget;
  const nearT = customThresholds?.nearTargetThreshold ?? defaults.nearTarget;

  if (isLowerBetter) {
    if (ratio <= onT) return "on_target";
    if (ratio <= nearT) return "near_target";
    return "off_target";
  }

  if (ratio >= onT) return "on_target";
  if (ratio >= nearT) return "near_target";
  return "off_target";
}

// Resolve display label for a status. Custom labels override defaults.
export function kpiStatusLabel(status, customLabels = null) {
  const defaults = { on_target: "On track", near_target: "At risk", off_target: "Behind", "no-data": "No data" };
  if (!customLabels) return defaults[status] || status;
  const labelKey = { on_target: "onTarget", near_target: "nearTarget", off_target: "offTarget" }[status];
  return (labelKey && customLabels[labelKey]) || defaults[status] || status;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function periodLabel(year, month, periodicity = "monthly") {
  if (!year) return "—";
  if (periodicity === "yearly") return `${year}`;
  if (periodicity === "quarterly") {
    // month is end-of-quarter (3/6/9/12) → derive quarter number
    const q = Math.ceil(month / 3);
    return `Q${q} ${year}`;
  }
  if (!month) return `${year}`;
  return `${MONTHS[month - 1]} ${year}`;
}

export function shortPeriodLabel(year, month, periodicity = "monthly") {
  if (!year) return "—";
  if (periodicity === "yearly") return `${year}`;
  if (periodicity === "quarterly") {
    const q = Math.ceil(month / 3);
    return `Q${q} '${String(year).slice(-2)}`;
  }
  if (!month) return `${year}`;
  return `${MONTHS[month - 1].slice(0, 3)} ${year}`;
}

// Format a percentage delta for display (e.g. +12.3% / −5.4%). Returns "—" if null.
export function formatDelta(pct) {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

// Return colour class for a delta — green if movement is favourable, red if not.
// Use direction so we know whether positive change is good (revenue) or bad (AR days).
export function deltaClass(pct, direction) {
  if (pct == null || !Number.isFinite(pct)) return "text-muted-foreground";
  const isLowerBetter = direction === "lower_is_better";
  const favourable = isLowerBetter ? pct < 0 : pct > 0;
  if (Math.abs(pct) < 0.5) return "text-muted-foreground"; // ~flat
  return favourable ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

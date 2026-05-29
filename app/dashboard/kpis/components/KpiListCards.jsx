import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatKpiValue,
  percentVsTarget,
  kpiStatus,
  kpiStatusLabel,
  periodLabel,
  formatDelta,
  deltaClass,
} from "../lib/kpi-format";
import { KpiSparkline } from "./KpiCharts";

const CATEGORY_LABEL = {
  financial: "Financial",
  operational: "Operational",
  hr: "HR",
  customer: "Customer",
  compliance: "Compliance",
};

const CATEGORY_ACCENT = {
  financial: "border-l-blue-500",
  operational: "border-l-purple-500",
  hr: "border-l-yellow-500",
  customer: "border-l-pink-500",
  compliance: "border-l-emerald-500",
};

export default function KpiListCards({ kpis }) {
  // Group by category, ordered by enum order
  const grouped = ["financial", "operational", "hr", "customer", "compliance"]
    .map((cat) => ({
      category: cat,
      items: kpis.filter((k) => k.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {grouped.map(({ category, items }) => (
        <section key={category} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {CATEGORY_LABEL[category]}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((k) => (
              <KpiCard key={k._id} kpi={k} accent={CATEGORY_ACCENT[category]} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function KpiCard({ kpi, accent }) {
  const latest = kpi.latestSnapshot;
  const status = latest
    ? kpiStatus(latest.actualValue, latest.targetAtTime, kpi.targetDirection, kpi.customThresholds)
    : "no-data";
  const pct = latest ? percentVsTarget(latest.actualValue, latest.targetAtTime) : null;
  const priorDelta = kpi.priorDeltaPct;

  const statusStyles = {
    on_target: "text-emerald-600 dark:text-emerald-400",
    near_target: "text-amber-600 dark:text-amber-400",
    off_target: "text-red-600 dark:text-red-400",
    "no-data": "text-muted-foreground",
  };

  const sparkColor =
    status === "on_target"
      ? "rgb(16 185 129)"
      : status === "near_target"
      ? "rgb(217 119 6)"
      : status === "off_target"
      ? "rgb(220 38 38)"
      : "rgb(107 114 128)";

  return (
    <Link href={`/dashboard/kpis/${kpi._id}`}>
      <Card className={`bg-card border-border border-l-4 ${accent} h-full transition hover:shadow-md`}>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{kpi.name}</p>
              {kpi.owner?.name && (
                <p className="truncate text-xs text-muted-foreground">
                  Owner: {kpi.owner.name}
                  {kpi.owner.employeeNumber ? ` · ${kpi.owner.employeeNumber}` : ""}
                </p>
              )}
            </div>
            {latest ? <TrendIcon status={status} /> : null}
          </div>

          {latest ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <p className={`text-2xl font-bold tabular-nums ${statusStyles[status]}`}>
                  {formatKpiValue(latest.actualValue, kpi.unit)}
                </p>
                <span className={`text-xs tabular-nums ${deltaClass(priorDelta, kpi.targetDirection)}`}>
                  {priorDelta != null ? formatDelta(priorDelta) : ""}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Target {formatKpiValue(latest.targetAtTime, kpi.unit)} · {pct?.toFixed(0)}% · {kpiStatusLabel(status, kpi.statusLabels)}
              </p>
              <KpiSparkline
                series={kpi.series}
                target={kpi.target}
                direction={kpi.targetDirection}
                color={sparkColor}
                height={36}
              />
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {periodLabel(latest.periodYear, latest.periodMonth, latest.periodicity || kpi.periodicity)}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground italic">No snapshot yet</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function TrendIcon({ status }) {
  if (status === "on_target") return <ArrowUpRight className="h-4 w-4 text-emerald-600" />;
  if (status === "off_target") return <ArrowDownRight className="h-4 w-4 text-red-600" />;
  return <Minus className="h-4 w-4 text-amber-600" />;
}

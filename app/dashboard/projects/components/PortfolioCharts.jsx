"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  LabelList,
} from "recharts";
import { ChartCard, ChartContainer, EmptyChartState } from "@/app/dashboard/components/ChartCard";

const kes = (n) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n || 0);

/**
 * Portfolio by status — a small donut. The colours are the ERP's own status
 * tones (the same ones the list's StatusBadge uses), so a state reads the same
 * on the chart as in the register. Identity is never colour-alone: every slice
 * is in the legend beside its count.
 */
const STATUS_TONES = {
  planning: { label: "Planning", fill: "#64748b" },
  active: { label: "Active", fill: "#10b981" },
  on_hold: { label: "On hold", fill: "#f59e0b" },
  completed: { label: "Completed", fill: "#3b82f6" },
  closed: { label: "Closed", fill: "#94a3b8" },
};

export function StatusDonut({ counts }) {
  const data = Object.entries(STATUS_TONES)
    .map(([key, t]) => ({ key, name: t.label, value: counts?.[key] ?? 0, fill: t.fill }))
    .filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <ChartCard title="Portfolio by status" subtitle={`${total} project${total === 1 ? "" : "s"}`}>
      {total === 0 ? (
        <EmptyChartState title="No projects yet" description="Status mix appears once you add projects" height={200} />
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="w-full sm:w-1/2">
            <ChartContainer height={190} minHeight={190}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {data.map((d) => (
                      <Cell key={d.key} fill={d.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg border border-border bg-popover p-2.5 text-sm shadow-lg">
                          <span className="font-medium text-foreground">{payload[0].payload.name}</span>
                          <span className="ml-2 text-muted-foreground tabular-nums">
                            {payload[0].value} ({Math.round((payload[0].value / total) * 100)}%)
                          </span>
                        </div>
                      ) : null
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
          <ul className="w-full sm:w-1/2 space-y-1.5">
            {data.map((d) => (
              <li key={d.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.fill }} />
                  <span className="truncate text-foreground">{d.name}</span>
                </span>
                <span className="shrink-0 tabular-nums font-medium text-foreground">
                  {d.value}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {Math.round((d.value / total) * 100)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

/**
 * Where the money is, across live projects — budget, committed, spent and
 * certified, as four labelled bars. One axis, one bar per measure, each in the
 * tone it carries everywhere else in the module (committed amber, spent red,
 * revenue green) and directly labelled, so the colour reinforces a reading the
 * label already gives.
 */
export function MoneyBars({ stats }) {
  const data = [
    { name: "Budget", value: stats?.totalBudget ?? 0, fill: "#64748b" },
    { name: "Committed", value: stats?.totalCommitted ?? 0, fill: "#f59e0b" },
    { name: "Spent", value: stats?.totalCosts ?? 0, fill: "#ef4444" },
    { name: "Certified", value: stats?.totalRevenue ?? 0, fill: "#10b981" },
  ];
  const any = data.some((d) => d.value > 0);

  return (
    <ChartCard title="Money across live projects" subtitle="Active & on-hold jobs">
      {!any ? (
        <EmptyChartState
          title="No figures yet"
          description="Budget, cost and certified totals appear once a budget is approved"
          height={200}
        />
      ) : (
        <ChartContainer height={200} minHeight={200}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 8 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                axisLine={false}
                tickLine={false}
                width={72}
                tick={{ fontSize: 12, fill: "var(--muted-foreground, #6b7280)" }}
              />
              <Tooltip
                cursor={{ fill: "var(--muted, #f3f4f6)", opacity: 0.4 }}
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border border-border bg-popover p-2.5 text-sm shadow-lg">
                      <span className="font-medium text-foreground">{payload[0].payload.name}</span>
                      <span className="ml-2 text-muted-foreground tabular-nums">
                        {kes(payload[0].value)}
                      </span>
                    </div>
                  ) : null
                }
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
                <LabelList
                  dataKey="value"
                  position="right"
                  formatter={(v) => kes(v)}
                  className="fill-foreground"
                  style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}
    </ChartCard>
  );
}

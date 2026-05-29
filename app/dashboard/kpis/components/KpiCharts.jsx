"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { formatKpiValue, shortPeriodLabel } from "../lib/kpi-format";

// ============================================
// SPARKLINE — tiny line for list cards
// ============================================
// No axes, no tooltip, no grid. Just the line + a faint target reference.
// Falls back to a thin placeholder line when there's only one point.
export function KpiSparkline({ series, target, direction, color = "currentColor", height = 40 }) {
  if (!series || series.length === 0) return <SparklineFallback height={height} />;

  const data = series.map((p) => ({ value: p.actualValue }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          {target != null && (
            <ReferenceLine
              y={target}
              stroke="currentColor"
              strokeOpacity={0.25}
              strokeDasharray="3 3"
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SparklineFallback({ height }) {
  return <div style={{ height }} className="flex items-center justify-center text-xs text-muted-foreground">No history</div>;
}

// ============================================
// FULL LINE CHART — for the detail page
// ============================================
export function KpiLineChart({ series, target, unit, periodicity = "monthly", height = 240 }) {
  if (!series || series.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center rounded-md border border-border bg-muted/20 text-sm text-muted-foreground">
        No snapshots yet
      </div>
    );
  }

  const data = series.map((p) => ({
    label: shortPeriodLabel(p.periodYear, p.periodMonth, periodicity),
    actual: p.actualValue,
    target: p.targetAtTime,
  }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="currentColor" strokeOpacity={0.4} />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            strokeOpacity={0.4}
            tickFormatter={(v) => compactNumber(v, unit)}
            width={60}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--background, 0 0% 100%))",
              border: "1px solid hsl(var(--border, 0 0% 80%))",
              fontSize: 12,
              borderRadius: 6,
            }}
            formatter={(v) => formatKpiValue(v, unit)}
            labelFormatter={(l) => l}
          />
          {target != null && (
            <ReferenceLine
              y={target}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeDasharray="4 4"
              label={{ value: "Target", position: "right", fontSize: 10, fill: "currentColor", fillOpacity: 0.6 }}
            />
          )}
          <Line type="monotone" dataKey="actual" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Compact axis labels — "5M" instead of "5,000,000".
function compactNumber(value, unit) {
  if (value == null || !Number.isFinite(value)) return "";
  if (unit === "percentage") return `${value.toFixed(0)}%`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toFixed(0);
}

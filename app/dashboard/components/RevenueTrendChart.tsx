"use client";

import { ChartCard, ChartContainer, EmptyChartState } from "./ChartCard";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ============================================
// CUSTOM TICK COMPONENT - Works in dark mode
// ============================================
const CustomAxisTick = ({ x, y, payload, textAnchor = "middle" }: any) => {
  return (
    <text
      x={x}
      y={y}
      dy={16}
      textAnchor={textAnchor}
      className="fill-muted-foreground text-xs"
      style={{ fontSize: "12px" }}
    >
      {payload.value}
    </text>
  );
};

const CustomYAxisTick = ({ x, y, payload }: any) => {
  const formattedValue = new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(payload.value);

  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      className="fill-muted-foreground text-xs"
      style={{ fontSize: "12px" }}
    >
      {formattedValue}
    </text>
  );
};

// ============================================
// REVENUE TREND CHART
// ============================================
interface RevenueTrendChartProps {
  data: Array<{
    month: string;
    revenue: number;
    expenses: number;
  }>;
}

export function RevenueTrendChart({ data }: RevenueTrendChartProps) {
  // Empty state
  if (!data || data.length === 0) {
    return (
      <ChartCard title="Revenue vs Expenses" subtitle="Last 6 months">
        <EmptyChartState
          title="No data yet"
          description="Revenue and expense data will appear here"
        />
      </ChartCard>
    );
  }

  // Format month labels (2024-01 → Jan)
  const formattedData = data.map((item) => ({
    ...item,
    monthLabel: new Date(item.month + "-01").toLocaleDateString("en-US", {
      month: "short",
    }),
  }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
        <p className="font-medium text-foreground mb-2">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{entry.name}</span>
            </div>
            <span className="font-medium text-foreground tabular-nums">
              {new Intl.NumberFormat("en-KE", {
                style: "currency",
                currency: "KES",
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(entry.value)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  // Custom Legend
  const CustomLegend = ({ payload }: any) => {
    if (!payload) return null;
    return (
      <div className="flex items-center justify-end gap-4 pb-2">
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-xs text-muted-foreground">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <ChartCard title="Revenue vs Expenses" subtitle="Last 6 months">
      <ChartContainer height={300}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={formattedData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="monthLabel"
              axisLine={false}
              tickLine={false}
              tick={<CustomAxisTick />}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={<CustomYAxisTick />}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend content={<CustomLegend />} verticalAlign="top" />
            <Line
              type="monotone"
              dataKey="revenue"
              name="Revenue"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ fill: "#10b981", strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, strokeWidth: 0 }}
            />
            <Line
              type="monotone"
              dataKey="expenses"
              name="Expenses"
              stroke="#ef4444"
              strokeWidth={2}
              dot={{ fill: "#ef4444", strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    </ChartCard>
  );
}

"use client";

import { ChartCard, ChartContainer, EmptyChartState } from "./ChartCard";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ============================================
// CUSTOM TICK COMPONENTS
// ============================================
const CustomAxisTick = ({ x, y, payload }: any) => {
  return (
    <text
      x={x}
      y={y}
      dy={16}
      textAnchor="middle"
      className="fill-muted-foreground text-xs"
      style={{ fontSize: "12px" }}
    >
      {payload.value}
    </text>
  );
};

const CustomYAxisTick = ({ x, y, payload }: any) => {
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      className="fill-muted-foreground text-xs"
      style={{ fontSize: "12px" }}
    >
      {payload.value}
    </text>
  );
};

// ============================================
// MOVEMENT TREND CHART
// ============================================
interface MovementTrendChartProps {
  data: Array<{
    date: string;
    stockIn: number;
    stockOut: number;
  }>;
}

export function MovementTrendChart({ data }: MovementTrendChartProps) {
  // Empty state
  if (!data || data.length === 0) {
    return (
      <ChartCard title="Stock Movement" subtitle="Last 7 days">
        <EmptyChartState
          title="No movement data"
          description="Stock movement trends will appear here"
        />
      </ChartCard>
    );
  }

  // Format dates
  const formattedData = data.map((item) => ({
    ...item,
    dayLabel: new Date(item.date).toLocaleDateString("en-US", {
      weekday: "short",
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
              {entry.value} units
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
    <ChartCard title="Stock Movement" subtitle="Last 7 days">
      <ChartContainer height={300}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={formattedData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="dayLabel"
              axisLine={false}
              tickLine={false}
              tick={<CustomAxisTick />}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={<CustomYAxisTick />}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend content={<CustomLegend />} verticalAlign="top" />
            <Area
              type="monotone"
              dataKey="stockIn"
              name="Stock In"
              stroke="#10b981"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorIn)"
            />
            <Area
              type="monotone"
              dataKey="stockOut"
              name="Stock Out"
              stroke="#f43f5e"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorOut)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </ChartCard>
  );
}

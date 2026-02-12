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
      style={{ fontSize: "11px" }}
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
      style={{ fontSize: "11px" }}
    >
      {payload.value}
    </text>
  );
};

// ============================================
// PLATFORM ACTIVITY CHART
// ============================================
interface PlatformActivityChartProps {
  data: Array<{
    date: string;
    label: string;
    newUsers: number;
    activeSessions: number;
    transactions: number;
  }>;
}

export function PlatformActivityChart({ data }: PlatformActivityChartProps) {
  // Empty state
  if (!data || data.length === 0) {
    return (
      <ChartCard title="Platform Activity" subtitle="Last 30 days">
        <EmptyChartState
          title="No activity data"
          description="Platform activity will appear here once there's data"
        />
      </ChartCard>
    );
  }

  // Show only every 5th label to avoid crowding
  const formattedData = data.map((item, index) => ({
    ...item,
    displayLabel: index % 5 === 0 ? item.label : "",
  }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    // Find the original item to get the full label
    const originalItem = formattedData.find((d) => d.label === label || d.displayLabel === label);
    const displayDate = originalItem?.label || label;

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
        <p className="font-medium text-foreground mb-2">{displayDate}</p>
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
              {entry.value}
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
      <div className="flex flex-wrap items-center justify-end gap-3 pb-2">
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
    <ChartCard title="Platform Activity" subtitle="Last 30 days">
      <ChartContainer height={300}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={formattedData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorNewUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorActiveSessions" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorTransactions" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={0.5}
              vertical={false}
            />
            <XAxis
              dataKey="displayLabel"
              axisLine={false}
              tickLine={false}
              tick={<CustomAxisTick />}
              interval={0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={<CustomYAxisTick />}
              width={35}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend content={<CustomLegend />} verticalAlign="top" />
            <Area
              type="monotone"
              dataKey="newUsers"
              name="New Users"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#colorNewUsers)"
              stackId="1"
            />
            <Area
              type="monotone"
              dataKey="activeSessions"
              name="Active Sessions"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#colorActiveSessions)"
              stackId="2"
            />
            <Area
              type="monotone"
              dataKey="transactions"
              name="Transactions"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#colorTransactions)"
              stackId="3"
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </ChartCard>
  );
}

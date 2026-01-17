"use client";

import { ChartCard, ChartContainer, EmptyChartState } from "./ChartCard";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ============================================
// CUSTOM TICK COMPONENTS - Works in dark mode
// ============================================
const CustomXAxisTick = ({ x, y, payload }: any) => {
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
// TOP PRODUCTS CHART
// ============================================
interface TopProductsChartProps {
  data: Array<{
    name: string;
    sku: string;
    quantity: number;
  }>;
}

export function TopProductsChart({ data }: TopProductsChartProps) {
  // Empty state
  if (!data || data.length === 0) {
    return (
      <ChartCard title="Top Products" subtitle="Most moved items">
        <EmptyChartState
          title="No product data"
          description="Top products will appear here"
        />
      </ChartCard>
    );
  }

  // Truncate long names
  const chartData = data.map((item) => ({
    ...item,
    displayName:
      item.name.length > 20 ? item.name.substring(0, 20) + "..." : item.name,
  }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload;
    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
        <p className="font-medium text-foreground mb-1">{data.name}</p>
        <p className="text-xs text-muted-foreground mb-2">SKU: {data.sku}</p>
        <p className="text-foreground">
          <span className="font-semibold">{data.quantity}</span> units moved
        </p>
      </div>
    );
  };

  return (
    <ChartCard title="Top Products" subtitle="Most moved items">
      <ChartContainer height={300}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={0.5}
              horizontal={true}
              vertical={false}
            />
            <XAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={<CustomXAxisTick />}
            />
            <YAxis
              type="category"
              dataKey="displayName"
              axisLine={false}
              tickLine={false}
              tick={<CustomYAxisTick />}
              width={100}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ className: "fill-muted/30" }}
            />
            <Bar
              dataKey="quantity"
              fill="#8b5cf6"
              radius={[0, 4, 4, 0]}
              barSize={24}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </ChartCard>
  );
}

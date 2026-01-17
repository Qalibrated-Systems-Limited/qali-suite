"use client";

import { ChartCard, ChartContainer, EmptyChartState } from "./ChartCard";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

// ============================================
// EXPENSE BREAKDOWN CHART
// ============================================
interface ExpenseBreakdownChartProps {
  data: Array<{
    category: string;
    value: number;
  }>;
}

const COLORS = [
  "#8b5cf6", // Violet (primary - complements yellow)
  "#3b82f6", // Blue
  "#06b6d4", // Cyan
  "#10b981", // Emerald
  "#f43f5e", // Rose
  "#ec4899", // Pink
  "#6366f1", // Indigo
  "#14b8a6", // Teal
];

export function ExpenseBreakdownChart({ data }: ExpenseBreakdownChartProps) {
  // Empty state
  if (!data || data.length === 0) {
    return (
      <ChartCard title="Expense Breakdown" subtitle="This month">
        <EmptyChartState
          title="No expenses yet"
          description="Expense breakdown will appear here"
        />
      </ChartCard>
    );
  }

  // Calculate total
  const total = data.reduce((sum, item) => sum + item.value, 0);

  // Format data with percentages
  const chartData = data.map((item, index) => ({
    ...item,
    name: item.category,
    percentage: ((item.value / total) * 100).toFixed(1),
    fill: COLORS[index % COLORS.length],
  }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload;
    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
        <p className="font-medium text-foreground mb-1">{data.category}</p>
        <p className="text-muted-foreground">
          {new Intl.NumberFormat("en-KE", {
            style: "currency",
            currency: "KES",
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(data.value)}
          <span className="ml-2">({data.percentage}%)</span>
        </p>
      </div>
    );
  };

  return (
    <ChartCard title="Expense Breakdown" subtitle="This month">
      <div className="flex flex-col lg:flex-row items-center gap-6">
        {/* Donut Chart */}
        <div className="w-full lg:w-1/2">
          <ChartContainer height={240}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>

        {/* Legend */}
        <div className="w-full lg:w-1/2 space-y-2 max-h-[240px] overflow-y-auto">
          {chartData.map((item, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: item.fill }}
                />
                <span className="text-sm text-foreground truncate">
                  {item.category.length > 25
                    ? item.category.substring(0, 25) + "..."
                    : item.category}
                </span>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-medium text-foreground tabular-nums">
                  {new Intl.NumberFormat("en-KE", {
                    style: "currency",
                    currency: "KES",
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(item.value)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.percentage}%
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ============================================
// MOVEMENT TREND CHART (Line Chart)
// ============================================
export function MovementTrendChart({ data }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground">Stock Movement Trend</CardTitle>
        <CardDescription className="text-muted-foreground">
          Last 7 days activity
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              className="fill-foreground"
              fontSize={13}
              fontWeight={500}
              tick={{ fill: "currentColor" }}
              stroke="currentColor"
              tickFormatter={(value) => {
                const date = new Date(value);
                return `${date.getMonth() + 1}/${date.getDate()}`;
              }}
              label={{
                value: "Date",
                position: "insideBottom",
                offset: -10,
                style: { fill: "#e6edf3", fontSize: 12 },
              }}
            />
            <YAxis
              className="fill-foreground"
              fontSize={13}
              fontWeight={500}
              tick={{ fill: "currentColor" }}
              stroke="currentColor"
              label={{
                value: "Quantity",
                angle: -90,
                position: "insideLeft",
                style: { fill: "#e6edf3", fontSize: 12 },
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(22 27 34)",
                border: "1px solid rgb(48 54 61)",
                borderRadius: "6px",
                color: "#e6edf3",
              }}
              labelStyle={{ color: "#e6edf3", fontWeight: 600 }}
            />
            <Legend
              wrapperStyle={{
                paddingTop: "20px",
              }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey="in"
              name="Stock In"
              stroke="#10b981"
              strokeWidth={3}
              dot={{ fill: "#10b981", r: 5 }}
              activeDot={{ r: 7 }}
            />
            <Line
              type="monotone"
              dataKey="out"
              name="Stock Out"
              stroke="#ef4444"
              strokeWidth={3}
              dot={{ fill: "#ef4444", r: 5 }}
              activeDot={{ r: 7 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ============================================
// CATEGORY DISTRIBUTION (Bar Chart)
// ============================================
export function CategoryDistributionChart({ data }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground">Stock by Category</CardTitle>
        <CardDescription className="text-muted-foreground">
          Inventory distribution
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 80 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="category"
              className="fill-foreground"
              fontSize={13}
              fontWeight={500}
              angle={-45}
              textAnchor="end"
              height={100}
              interval={0}
              tick={{ fill: "currentColor" }}
              stroke="currentColor"
            />
            <YAxis
              className="fill-foreground"
              fontSize={13}
              fontWeight={500}
              tick={{ fill: "currentColor" }}
              stroke="currentColor"
              label={{
                value: "Quantity",
                angle: -90,
                position: "insideLeft",
                style: { fill: "currentColor", fontSize: 12 },
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(22 27 34)",
                border: "1px solid rgb(48 54 61)",
                borderRadius: "6px",
                color: "#e6edf3",
              }}
              labelStyle={{ color: "#e6edf3", fontWeight: 600 }}
              formatter={(value) => [value, "Items in Stock"]}
            />
            <Bar
              dataKey="totalStock"
              fill="#eab308"
              radius={[6, 6, 0, 0]}
              label={{
                position: "top",
                fill: "#e6edf3",
                fontSize: 12,
                fontWeight: 600,
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ============================================
// REQUEST STATUS PIE CHART
// ============================================
export function RequestStatusChart({ data }) {
  const COLORS = {
    pending: "#f59e0b",
    approved: "#10b981",
    rejected: "#ef4444",
    fulfilled: "#06b6d4",
    partially_fulfilled: "#8b5cf6",
    cancelled: "#6b7280",
  };

  const chartData = Object.entries(data)
    .filter(([_, value]) => value > 0)
    .map(([key, value]) => ({
      name: key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      value,
      color: COLORS[key],
    }));

  const RADIAN = Math.PI / 180;
  const renderCustomizedLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
    name,
  }) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor={x > cx ? "start" : "end"}
        dominantBaseline="central"
        fontSize={12}
        fontWeight={600}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground">Request Status</CardTitle>
        <CardDescription className="text-muted-foreground">
          Current status breakdown
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={{
                stroke: "hsl(var(--foreground))",
                strokeWidth: 1,
              }}
              label={renderCustomizedLabel}
              outerRadius={100}
              fill="#8884d8"
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
                color: "hsl(var(--foreground))",
              }}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              wrapperStyle={{
                paddingTop: "20px",
                color: "hsl(var(--foreground))",
              }}
              formatter={(value) => (
                <span style={{ color: "hsl(var(--foreground))", fontSize: 13 }}>
                  {value}
                </span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ============================================
// TOP PRODUCTS CHART (Horizontal Bar)
// ============================================
export function TopProductsChart({ data }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground">Most Active Products</CardTitle>
        <CardDescription className="text-muted-foreground">
          Top 5 by movements
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              className="fill-foreground"
              fontSize={13}
              fontWeight={500}
              tick={{ fill: "currentColor" }}
              stroke="currentColor"
              label={{
                value: "Number of Movements",
                position: "insideBottom",
                offset: -10,
                style: { fill: "#e6edf3", fontSize: 12 },
              }}
            />
            <YAxis
              type="category"
              dataKey="name"
              className="fill-foreground"
              fontSize={13}
              fontWeight={500}
              width={180}
              tick={{ fill: "currentColor" }}
              stroke="currentColor"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(22 27 34)",
                border: "1px solid rgb(48 54 61)",
                borderRadius: "6px",
                color: "#e6edf3",
              }}
              labelStyle={{ color: "#e6edf3", fontWeight: 600 }}
              formatter={(value) => [value, "Movements"]}
            />
            <Bar
              dataKey="totalMovements"
              fill="#8b5cf6"
              radius={[0, 6, 6, 0]}
              label={{
                position: "right",
                fill: "#e6edf3",
                fontSize: 12,
                fontWeight: 600,
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

"use client";

import React from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  LineChart,
  Tooltip,
} from "recharts";

function salesTrendsChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={"_id.month"} />
        <YAxis />

        <Tooltip
          formatter={(value, name) => {
            if (name === "Sales") {
              return [value, "Net Weight"];
            }
          }}
          labelClassName="font-bold"
          wrapperClassName="!text-sm dark:!bg-black rounded-md dark:!border-border"
          separator=": "
        />
        <Legend
          iconType="circle"
          formatter={(value) => {
            if (value === "totalNetWeight") {
              return <div className="text-sm"> Net Weight</div>;
            }
          }}
        />

        <Line
          type="monotone"
          dataKey="Sales"
          stroke="#ec4899"
          activeDot={{ r: 8 }}
        />
        <Line type="monotone" dataKey="Purchases" stroke="#82ca9d" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default salesTrendsChart;

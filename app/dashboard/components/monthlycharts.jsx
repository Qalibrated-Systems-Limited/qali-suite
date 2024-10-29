"use client";

import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { ChartBarStackedIcon } from "lucide-react";

export function MonthlyAggregatesStats({ data }) {
  return (
    <Card className="my-4">
      <CardHeader>
        <CardTitle className="flex text-lg items-center gap-2">
          <ChartBarStackedIcon />
          <span>Monthly summary this year</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pl-0">
        <ResponsiveContainer height={350} width={"100%"}>
          <BarChart
            data={data ?? []}
            className="[&_.recharts-tooltip-cursor]:fill-zinc-200 dark:[&_.recharts-tooltip-cursor]:fill-zinc-800"
          >
            <XAxis dataKey={"_id.month"} stroke="#888888" fontSize={12} />
            <YAxis stroke="#888888" fontSize={12} />
            <Tooltip
              formatter={(value, name) => {
                if (name === "totalNetWeight") {
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
            <Bar dataKey={"totalNetWeight"} stackId={1} fill="#ec4899" />
            {/* <Bar
          dataKey={"overloads_above_5000_count"}
          stackId={1}
          fill="#B2B2B6"
          radius={[4, 4, 0, 0]}
        /> */}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default MonthlyAggregatesStats;

"use client";

import { LineChartIcon } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
} from "../../../../components/ui/card";

const data = [
  {
    name: "Jan",
    delta: 40,
    alpha: 24,
    canary: 24,
  },
  {
    name: "Feb",
    delta: 30,
    alpha: 13,
    canary: 22,
  },
  {
    name: "Mar",
    delta: 20,
    alpha: 58,
    canary: 29,
  },
  {
    name: "Apr",
    delta: 14,
    alpha: 30,
    canary: 15,
  },
  {
    name: "May",
    delta: 29,
    alpha: 28,
    canary: 18,
  },
  {
    name: "Jun",
    delta: 19,
    alpha: 19,
    canary: 10,
  },
  {
    name: "Jul",
    delta: 34,
    alpha: 24,
    canary: 14,
  },
  {
    name: "Aug",
    delta: 21,
    alpha: 20,
    canary: 19,
  },
  {
    name: "Sep",
    delta: 49,
    alpha: 43,
    canary: 20,
  },
  {
    name: "Oct",
    delta: 43,
    alpha: 55,
    canary: 4,
  },
  {
    name: "Nov",
    delta: 39,
    alpha: 40,
    canary: 25,
  },
  {
    name: "Dec",
    delta: 34,
    alpha: 43,
    canary: 11,
  },
];

const data2 = [
  {
    name: "Jan",
    Ahero: 40,
    Mariakani: 24,
    Athiriver: 24,
  },
  {
    name: "Feb",
    Ahero: 30,
    Mariakani: 13,
    Athiriver: 22,
  },
  {
    name: "Mar",
    Ahero: 20,
    Mariakani: 58,
    Athiriver: 29,
  },
  {
    name: "Apr",
    Ahero: 14,
    Athiriver: 30,
    Mariakani: 15,
  },
  {
    name: "May",
    Ahero: 29,
    Athiriver: 28,
    Mariakani: 18,
  },
  {
    name: "Jun",
    Ahero: 19,
    Athiriver: 19,
    Mariakani: 10,
  },
  {
    name: "Jul",
    Ahero: 34,
    Athiriver: 24,
    Mariakani: 14,
  },
  {
    name: "Aug",
    Ahero: 21,
    Athiriver: 20,
    Mariakani: 19,
  },
  {
    name: "Sep",
    Ahero: 49,
    Athiriver: 43,
    Mariakani: 20,
  },
  {
    name: "Oct",
    Ahero: 43,
    Athiriver: 55,
    Mariakani: 4,
  },
  {
    name: "Nov",
    Ahero: 39,
    Athiriver: 40,
    Mariakani: 25,
  },
  {
    name: "Dec",
    Ahero: 34,
    Athiriver: 43,
    Mariakani: 11,
  },
];

function WeeklyDistributionLine({ data }) {
  return (
    <Card className="my-4">
      <CardHeader>
        <CardTitle className="flex text-lg items-center gap-2">
          <LineChartIcon />
          <span>Weekly Summary</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pl-0">
        <ResponsiveContainer height={350} width={"100%"}>
          <LineChart data={data}>
            <XAxis fontSize={12} dataKey={"_id.date"} stroke="#888888" />
            <YAxis fontSize={12} stroke="#888888" />
            <CartesianGrid strokeDasharray={"3 3"} />
            <Line
              dataKey={"totalNetWeightOutbound"}
              type={"monotone"}
              stroke="#ec4899"
            />
            <Line
              dataKey={"totalNetWeightInbound"}
              type={"monotone"}
              stroke="#f9a8d4"
            />

            <Legend
              formatter={(value) => <span className="capitalize">{value}</span>}
            />
            <Tooltip
              labelClassName="font-bold"
              wrapperClassName="!text-sm dark:!bg-black rounded-md dark:!border-border"
              separator=": "
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default WeeklyDistributionLine;

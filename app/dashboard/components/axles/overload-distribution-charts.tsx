"use client";



import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

function OverloadDistributionCharts() {
  const data = [
    {
      name: "Ahero",
      value: 120,
      color: "#84cc16",
    },
    {
      name: "Mariakani",
      value: 100,
      color: "#3b82f6",
    },
    {
      name: "AthiRiver",
      value: 200,
      color: "#f97316",
    },
  ];

  return (
    <ResponsiveContainer height={150} width={"100%"}>
      <PieChart>
        <Tooltip
          labelClassName="!font-bold"
          wrapperClassName="!text-sm dark:!bg-black rounded-md dark:!border-border dark:[&_.recharts-tooltip-item]:!text-white  "
        />
        <Pie dataKey={"value"} data={data} nameKey={"name"}>
          {data.map((item) => (
            <Cell fill={item.color} key={item.name} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export default OverloadDistributionCharts;

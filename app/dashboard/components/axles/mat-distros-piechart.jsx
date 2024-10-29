"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

function MatDistorsPieChart({ data }) {
  return (
    <ResponsiveContainer height={150} width={"100%"}>
      <PieChart>
        <Tooltip
          labelClassName="!font-bold"
          wrapperClassName="!text-sm dark:!bg-black rounded-md dark:!border-border dark:[&_.recharts-tooltip-item]:!text-white  "
        />
        <Pie
          dataKey={"totalNetWeight"}
          data={data}
          nameKey={"_id"}
          fill="#ec4899"
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export default MatDistorsPieChart;

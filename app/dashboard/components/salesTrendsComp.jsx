import React from "react";
import { monthlySalesDistro } from "../../mongodb/queries/queries";
import SalesTrendCharts from "./sales-trends";

async function SalesTrendsComp() {
  const result = await monthlySalesDistro();

  return <SalesTrendCharts data={result} />;
}

export default SalesTrendsComp;

export const SalesTrendsSkeleton = () => {
  return (
    <div className="bg-card text-card-foreground shadow-lg p-4 rounded-lg animate-pulse">
      <div className="h-6 bg-gray-300 rounded w-3/4 mb-4"></div>
      <div className="h-64 bg-gray-300 rounded"></div>
    </div>
  );
};

import React from "react";
import { getTopSellingProducts } from "../../mongodb/queries/queries";
import TopSellingProductsBars from "./top-sales-bars";

async function TopSalesComp() {
  const result = await getTopSellingProducts();

  return <TopSellingProductsBars data={result} />;
}

export default TopSalesComp;

export const TopSellingProductBarsSkeleton = () => {
  return (
    <div className="bg-card text-card-foreground shadow-lg p-4 rounded-lg animate-pulse">
      <div className="h-6 bg-gray-300 rounded w-3/4 mb-4"></div>
      <div className="h-64 bg-gray-300 rounded"></div>
    </div>
  );
};

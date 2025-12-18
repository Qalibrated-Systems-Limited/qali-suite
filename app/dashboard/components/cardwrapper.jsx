import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  getStockAggregate,
  getTotalSaleThisMonth,
  invoicesCount,
} from "../../mongodb/queries/queries";

const currentDate = new Date();
const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const currentMonth = monthNames[currentDate.getMonth()];

async function Cardwrapper() {
  const result = await Promise.all([
    getTotalSaleThisMonth(),
    invoicesCount(),
    getStockAggregate(),
  ]);

  let totalSale = 0;
  let invoices = 0;
  let stocks = 0;
  let stockValue = 0;
  if (result && result.length > 2) {
    console.log(result);
    if (result[0]) {
      totalSale = (result[0] / 1000000).toFixed(2);
    }

    invoices = result[1];
    if (result[2]) {
      stocks = result[2].totalCount;
      stockValue = (result[2].totalValue / 1000000).toFixed(2);
    }
  }
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card className="bg-card text-card-foreground shadow-lg">
        <CardHeader>
          <h2 className="text-xl font-bold">{currentMonth} sale</h2>
        </CardHeader>
        <CardContent>
          <p className="text-2xl text-primary">KES {totalSale}M</p>
        </CardContent>
      </Card>
      <Card className="bg-card text-card-foreground shadow-lg">
        <CardHeader>
          <h2 className="text-xl font-bold">Total Stock</h2>
        </CardHeader>
        <CardContent>
          <p className="text-2xl text-primary">{stocks}</p>
        </CardContent>
      </Card>
      <Card className="bg-card text-card-foreground shadow-lg">
        <CardHeader>
          <h2 className="text-xl font-bold">Stock value</h2>
        </CardHeader>
        <CardContent>
          <p className="text-2xl text-primary">KES {stockValue}M</p>
        </CardContent>
      </Card>
      <Card className="bg-card text-card-foreground shadow-lg">
        <CardHeader>
          <h2 className="text-xl font-bold">Invoices</h2>
        </CardHeader>
        <CardContent>
          <p className="text-2xl text-primary">{invoices}</p>
        </CardContent>
      </Card>
    </section>
  );
}

export default Cardwrapper;

export const TopFourCardsSkeleton = () => {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {Array(4)
        .fill()
        .map((_, index) => (
          <div
            key={index}
            className="bg-card text-card-foreground shadow-lg p-4 rounded-lg animate-pulse"
          >
            <div className="h-6 bg-gray-300 rounded w-3/4 mb-4"></div>
            <div className="h-8 bg-gray-300 rounded w-1/2"></div>
          </div>
        ))}
    </section>
  );
};

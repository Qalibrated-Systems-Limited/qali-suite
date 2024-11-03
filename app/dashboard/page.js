import React, { Suspense } from "react";
import { Card, CardHeader, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";

import SalesTrendComp, {
  SalesTrendsSkeleton,
} from "./components/salesTrendsComp";

import { PlusIcon } from "lucide-react";
import InvoicesList from "./components/invoices-list"; // Importing the InvoicesList component
import { InvoiceSkeleton } from "../../components/ui/skeletons";
import CardWrapper, { TopFourCardsSkeleton } from "./components/cardwrapper";
import TopSellingProductComp, {
  TopSellingProductBarsSkeleton,
} from "./components/topSalesComp";

const data = [
  { name: "Jan", sales: 4000, stock: 2400 },
  { name: "Feb", sales: 3000, stock: 1398 },
  { name: "Mar", sales: 2000, stock: 9800 },
  { name: "Apr", sales: 2780, stock: 3908 },
  { name: "May", sales: 1890, stock: 4800 },
  { name: "Jun", sales: 2390, stock: 3800 },
  { name: "Jul", sales: 3490, stock: 4300 },
];

const invoices = [
  {
    id: "INV-20241102-0003",
    amount: 90000,
    customer: "Imenti Tea Factory",
    date: "2024-11-02",
  },
  {
    id: "INV-20241102-0004",
    amount: 45000,
    customer: "Kisii Tea Factory",
    date: "2024-11-03",
  },
  // Add more invoice data here...
];

const page = () => {
  return (
    <div className="bg-background text-foreground min-h-screen p-6">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-primary">Dashboard</h1>
        <Button>
          <PlusIcon size={30} className="md:hidden" />
          <span className="hidden md:block"> Add New Item</span>
        </Button>
      </header>
      <Suspense fallback={<TopFourCardsSkeleton />}>
        <CardWrapper />
      </Suspense>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <Card className="bg-card text-card-foreground shadow-lg col-span-2">
          <CardHeader>
            <h2 className="text-xl font-bold">Sales Trends</h2>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<SalesTrendsSkeleton />}>
              <SalesTrendComp />
            </Suspense>
          </CardContent>
        </Card>
        <Card className="bg-card text-card-foreground shadow-lg">
          <CardHeader>
            <h2 className="text-xl font-bold">Recent Invoices</h2>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<InvoiceSkeleton />}>
              <InvoicesList />
            </Suspense>
          </CardContent>
        </Card>
        <Card className="bg-card text-card-foreground shadow-lg col-span-3">
          <CardHeader>
            <h2 className="text-xl font-bold">Top-Selling Products</h2>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<TopSellingProductBarsSkeleton />}>
              <TopSellingProductComp />
            </Suspense>
          </CardContent>
        </Card>
      </section>
    </div>
  );
};

export default page;

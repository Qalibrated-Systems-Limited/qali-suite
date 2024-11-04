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
import Link from "next/link";

const page = () => {
  return (
    <div className="bg-background text-foreground min-h-screen p-6">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-primary">Dashboard</h1>
        <Link href={"/dashboard/invoices/create"}>
          <Button>
            <PlusIcon size={30} className="md:hidden" />
            <span className="hidden md:block"> Add Invoice</span>
          </Button>
        </Link>
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

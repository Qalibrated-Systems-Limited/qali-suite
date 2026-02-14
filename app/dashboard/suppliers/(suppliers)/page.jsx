import { Suspense } from "react";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import {
  SupplierStatsCards,
  SupplierStatsSkeleton,
  SuppliersTableServer,
  SuppliersTableSkeleton,
  SuppliersPaginationServer,
} from "../components/SupplierServerComponents";

export const metadata = {
  title: "Suppliers | ERP System",
  description: "Manage your suppliers",
};

export default async function SuppliersPage({ searchParams }) {
  const params = await searchParams;

  const query = params?.query || "";
  const currentPage = Number(params?.page) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
        <p className="text-muted-foreground">
          Manage your supplier relationships
        </p>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<SupplierStatsSkeleton />}>
        <SupplierStatsCards />
      </Suspense>

      {/* Search */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <Search placeholder="Search suppliers by name, email, or tax PIN..." />
        </CardContent>
      </Card>

      {/* Suppliers Table - Stream independently */}
      <Suspense fallback={<SuppliersTableSkeleton />}>
        <SuppliersTableServer query={query} page={currentPage} />
      </Suspense>

      {/* Pagination - Stream after table */}
      <Suspense fallback={null}>
        <SuppliersPaginationServer query={query} />
      </Suspense>
    </div>
  );
}

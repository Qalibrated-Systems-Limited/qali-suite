import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import {
  CustomerStatsCards,
  CustomerStatsSkeleton,
  CustomersTableServer,
  CustomersTableSkeleton,
  CustomersPaginationServer,
  PaginationSkeleton,
} from "../components/CustomerServerComponents";

export const metadata = {
  title: "Customers | ERP System",
  description: "Manage your customers",
};

export default async function CustomersPage({ searchParams }) {
  const params = await searchParams;

  const query = params?.query || "";
  const currentPage = Number(params?.page) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Customers</h1>
        <Button asChild size="sm">
          <Link href="/dashboard/parties/create?type=customer">
            <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">New Customer</span>
          </Link>
        </Button>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<CustomerStatsSkeleton />}>
        <CustomerStatsCards />
      </Suspense>

      {/* Search */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <Search placeholder="Search customers by name, email, or tax PIN..." />
        </CardContent>
      </Card>

      {/* Customers Table - Stream independently */}
      <Suspense fallback={<CustomersTableSkeleton />}>
        <CustomersTableServer query={query} page={currentPage} />
      </Suspense>

      {/* Pagination - Stream independently */}
      <Suspense fallback={<PaginationSkeleton />}>
        <CustomersPaginationServer query={query} />
      </Suspense>
    </div>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Search from "@/components/search";
import { Card, CardContent } from "@/components/ui/card";
import {
  PartyStatsCards,
  PartyStatsSkeleton,
  PartiesTableServer,
  PartiesTableSkeleton,
  PartiesPaginationServer,
} from "../components/PartyServerComponents";

export const metadata = {
  title: "Parties | ERP System",
  description: "Manage customers, suppliers, and employees",
};

export default async function PartiesPage({ searchParams }) {
  const params = await searchParams;

  const query = params?.query || "";
  const type = params?.type || "all";
  const currentPage = Number(params?.page) || 1;

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Parties</h1>
        <Button asChild size="sm">
          <Link href="/dashboard/parties/create">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Party
          </Link>
        </Button>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<PartyStatsSkeleton />}>
        <PartyStatsCards />
      </Suspense>

      {/* Search */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <Search placeholder="Search parties by name, email, or tax PIN..." />
        </CardContent>
      </Card>

      {/* Parties Table - Stream independently */}
      <Suspense fallback={<PartiesTableSkeleton />}>
        <PartiesTableServer query={query} page={currentPage} type={type} />
      </Suspense>

      {/* Pagination - Stream after table */}
      <Suspense fallback={null}>
        <PartiesPaginationServer query={query} type={type} />
      </Suspense>
    </div>
  );
}

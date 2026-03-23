import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { fetchClaimPages } from "@/app/mongodb/queries/claimQueries";
import Pagination from "@/components/pagination";
import { ClaimsListSkeleton } from "../components/ClaimListWithFilter";

import { Suspense } from "react";
import { StatsCardsSkeleton } from "../components/ClaimsSkeleton";
import ClaimStats from "../components/ClaimStats";
import ClaimListWithFiltersServerComp from "../components/ClaimListWithFiltersServerComp";

export const metadata = {
  title: "All Claims | ERP System",
  description: "View and manage all employee claims",
};

// Async pagination component - streams in after data loads
async function ClaimsPagination({ query, filters }) {
  const totalPages = await fetchClaimPages(query, filters);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center mt-4">
      <Pagination totalPages={totalPages} />
    </div>
  );
}

export default async function AllClaimsPage({ searchParams }) {
  const params = await searchParams;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Check if user is accountant or admin
  const userRole = user.role?.toLowerCase();
  if (userRole !== "accountant" && userRole !== "admin") {
    redirect("/dashboard/claims/my-claims");
  }

  const query = params?.query || "";
  const status = params?.status || "all";
  const claimType = params?.type || "all";
  const filters = { status, claimType };

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">All Claims</h1>
        <Button asChild size="sm">
          <Link href="/dashboard/claims/create">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Claim
          </Link>
        </Button>
      </div>

      {/* Claim Stats */}
      <Suspense fallback={<StatsCardsSkeleton />}>
        <ClaimStats />
      </Suspense>

      {/* Claims List with Filters */}
      <Suspense fallback={<ClaimsListSkeleton />}>
        <ClaimListWithFiltersServerComp AreMyclaims={false} params={params} />
      </Suspense>

      {/* Pagination - Streams in after data loads */}
      <Suspense fallback={null}>
        <ClaimsPagination query={query} filters={filters} />
      </Suspense>
    </div>
  );
}

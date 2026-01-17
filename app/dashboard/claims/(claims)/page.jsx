import { auth } from "@/auth";
import { redirect } from "next/navigation";
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

  // Fetch all claims with filters
  const filters = { status, claimType };
  const totalPages = await fetchClaimPages(query, filters);

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="space-y-1 sm:space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
          All Claims
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          View and manage all employee expense claims
        </p>
      </div>

      {/* Claim Stats */}
      <Suspense fallback={<StatsCardsSkeleton />}>
        <ClaimStats />
      </Suspense>

      {/* Claims List with Filters */}
      <Suspense fallback={<ClaimsListSkeleton />}>
        <ClaimListWithFiltersServerComp AreMyclaims={false} params={params} />
      </Suspense>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-4">
          <Pagination totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}

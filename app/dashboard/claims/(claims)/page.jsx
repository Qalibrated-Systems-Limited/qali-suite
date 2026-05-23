import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canReviewClaims } from "@/lib/permissions";
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
  title: "Employee Expenses | ERP System",
  description: "Cash advances, reimbursements, and settlements",
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

  // Single source of truth — same gate the sidebar uses to show the link.
  // Previously this checked only lowercased "accountant"/"admin", which
  // bounced CFO and Finance Manager away from a page the sidebar exposed
  // to them.
  if (!canReviewClaims(user.role)) {
    redirect("/dashboard/my-claims");
  }

  const query = params?.query || "";
  const status = params?.status || "all";
  const claimType = params?.type || "all";
  const filters = { status, claimType };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Employee Expenses
          </h1>
          <p className="text-xs text-muted-foreground">
            Cash advances, reimbursements, and settlements
          </p>
        </div>
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

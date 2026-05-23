import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { fetchUserClaimPages } from "@/app/mongodb/queries/claimQueries";
import Pagination from "@/components/pagination";
import { ClaimsListSkeleton } from "../claims/components/ClaimListWithFilter";
import { Suspense } from "react";
import ClaimStats from "../claims/components/ClaimStats";
import { StatsCardsSkeleton } from "../claims/components/ClaimsSkeleton";
import ClaimListWithFiltersServerComp from "../claims/components/ClaimListWithFiltersServerComp";

export const metadata = {
  title: "My Expenses | ERP System",
  description: "Your cash advances, reimbursements, and settlements",
};

export default async function MyClaimsPage({ searchParams }) {
  const params = await searchParams;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;
  const query = params?.query || "";
  const status = params?.status || "all";
  const claimType = params?.type || "all";

  // Get user role (normalize)
  let userRole = user.role || "user";
  if (userRole !== "Store Manager" && userRole !== "Admin") {
    userRole = userRole.toLowerCase();
  }

  // Fetch data
  const filters = { status, claimType };
  const totalPages = await fetchUserClaimPages(
    user.id,
    userRole,
    query,
    filters
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">My Expenses</h1>
          <p className="text-xs text-muted-foreground">
            Your cash advances, reimbursements, and settlements
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
        <ClaimStats userId={user.id} userRole={userRole} />
      </Suspense>

      {/* Claims List with Filters */}
      <Suspense fallback={<ClaimsListSkeleton />}>
        <ClaimListWithFiltersServerComp AreMyclaims={true} params={params} />
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

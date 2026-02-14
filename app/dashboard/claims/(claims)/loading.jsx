import { StatsCardsSkeleton } from "../components/ClaimsSkeleton";
import { ClaimsListSkeleton } from "../components/ClaimListWithFilter";

export default function ClaimsLoading() {
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

      {/* Stats Skeleton */}
      <StatsCardsSkeleton />

      {/* Claims List Skeleton */}
      <ClaimsListSkeleton />
    </div>
  );
}

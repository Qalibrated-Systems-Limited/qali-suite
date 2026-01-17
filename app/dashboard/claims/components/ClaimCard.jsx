"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ClaimStatusBadge, ClaimTypeBadge } from "./ClaimStatusBadge";
import { formatDistanceToNow } from "date-fns";
import {
  User,
  Calendar,
  DollarSign,
  MapPin,
  FileText,
  ChevronRight,
} from "lucide-react";

/**
 * Claim Card Component
 * Responsive card for displaying claim summary
 * Mobile: Stacked layout with full details
 * Desktop: Grid layout with inline details
 */
export function ClaimCard({ claim }) {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (date) => {
    if (!date) return "N/A";
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  };

  return (
    <Link href={`/dashboard/claims/${claim._id}`}>
      <Card className="p-4 sm:p-6 hover:shadow-lg hover:border-yellow-500/50 transition-all duration-200 cursor-pointer group active:scale-[0.98]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-base sm:text-lg font-semibold text-foreground group-hover:text-yellow-600 transition-colors truncate">
                {claim.claimNumber}
              </h3>
              <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground group-hover:text-yellow-600 transition-all group-hover:translate-x-1 hidden sm:block" />
            </div>
            <p className="text-sm sm:text-base text-muted-foreground line-clamp-2">
              {claim.description}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <ClaimStatusBadge status={claim.status} />
            <ClaimTypeBadge claimType={claim.claimType} />
          </div>
        </div>

        {/* Amount - Prominent */}
        <div className="mb-4 p-4 bg-muted/50 rounded-lg border border-border">
          <div className="flex items-center gap-3">
            <DollarSign className="w-6 h-6 sm:w-5 sm:h-5 text-yellow-600 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Amount</p>
              <p className="text-xl sm:text-lg font-bold text-foreground">
                {formatCurrency(claim.totalAmount)}
              </p>
            </div>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm sm:text-base">
          {/* Employee */}
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <User className="w-4 h-4 sm:w-4 sm:h-4 flex-shrink-0" />
            <span className="truncate">{claim.employee.name}</span>
          </div>

          {/* Date */}
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <Calendar className="w-4 h-4 sm:w-4 sm:h-4 flex-shrink-0" />
            <span className="truncate">{formatDate(claim.claimDate)}</span>
          </div>

          {/* Destination (for advances) */}
          {claim.claimType === "advance_request" &&
            claim.advanceDetails?.destination && (
              <div className="flex items-center gap-2.5 text-muted-foreground sm:col-span-2">
                <MapPin className="w-4 h-4 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="truncate">
                  {claim.advanceDetails.destination}
                </span>
              </div>
            )}

          {/* Expense Items Count (for reimbursements) */}
          {claim.claimType === "reimbursement" && claim.items?.length > 0 && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <FileText className="w-4 h-4 sm:w-4 sm:h-4 flex-shrink-0" />
              <span>
                {claim.items.length} expense item
                {claim.items.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>

        {/* Balance (for settlements) */}
        {claim.claimType === "advance_return" && claim.returnDetails && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm sm:text-base">
              <span className="text-muted-foreground font-medium">
                Balance:
              </span>
              <span
                className={`font-semibold ${
                  claim.returnDetails.balance > 0
                    ? "text-red-600 dark:text-red-400"
                    : claim.returnDetails.balance < 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-muted-foreground"
                }`}
              >
                {claim.returnDetails.balance > 0
                  ? `Employee owes ${formatCurrency(
                      claim.returnDetails.balance
                    )}`
                  : claim.returnDetails.balance < 0
                  ? `Company owes ${formatCurrency(
                      Math.abs(claim.returnDetails.balance)
                    )}`
                  : "Settled"}
              </span>
            </div>
          </div>
        )}

        {/* Mobile: Show arrow on bottom */}
        <div className="sm:hidden mt-4 pt-4 border-t border-border flex items-center justify-end">
          <span className="text-sm text-yellow-600 dark:text-yellow-400 font-medium flex items-center gap-1.5">
            View Details
            <ChevronRight className="w-4 h-4" />
          </span>
        </div>
      </Card>
    </Link>
  );
}

/**
 * Claim Card Skeleton
 */
export function ClaimCardSkeleton() {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 space-y-2">
          <div className="h-5 w-32 bg-muted rounded animate-pulse" />
          <div className="h-4 w-full bg-muted rounded animate-pulse" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="h-6 w-28 bg-muted rounded animate-pulse" />
          <div className="h-6 w-24 bg-muted rounded animate-pulse" />
        </div>
      </div>

      <div className="mb-4 p-3 bg-muted/50 rounded-lg">
        <div className="h-8 w-32 bg-muted rounded animate-pulse" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="h-4 bg-muted rounded animate-pulse" />
        <div className="h-4 bg-muted rounded animate-pulse" />
      </div>
    </Card>
  );
}

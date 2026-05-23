"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClaimStatusBadge, ClaimTypeBadge } from "./ClaimStatusBadge";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
  }).format(amount || 0);
}

function formatWhen(date) {
  if (!date) return "—";
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

function balanceLabel(claim) {
  if (claim.claimType !== "advance_return" || !claim.returnDetails) return null;
  const b = claim.returnDetails.balance;
  if (b > 0)
    return {
      text: `Employee owes ${formatCurrency(b)}`,
      tone: "text-red-600 dark:text-red-400",
    };
  if (b < 0)
    return {
      text: `Company owes ${formatCurrency(Math.abs(b))}`,
      tone: "text-green-600 dark:text-green-400",
    };
  return { text: "Settled", tone: "text-muted-foreground" };
}

export function ClaimsListWithFilters({
  claims,
  currentStatus = "all",
  currentType = "all",
  showStatusFilter = true,
  showTypeFilter = true,
  emptyMessage = "No claims found",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleFilterChange = (filterType, value) => {
    const params = new URLSearchParams(searchParams);
    const key = filterType === "type" ? "type" : filterType;
    if (value === "all") params.delete(key);
    else params.set(key, value);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  const statusFilters = [
    { value: "all", label: "All" },
    { value: "submitted", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "paid", label: "Paid" },
    { value: "pending_return", label: "Pending Settlement" },
    { value: "pending_payment", label: "Pending Payment" },
    { value: "rejected", label: "Rejected" },
    { value: "closed", label: "Closed" },
  ];

  const typeFilters = [
    { value: "all", label: "All Types" },
    { value: "advance_request", label: "Cash Advances" },
    { value: "reimbursement", label: "Reimbursements" },
    { value: "advance_return", label: "Settlements" },
  ];

  return (
    <div className="space-y-3">
      {/* Filters — compact strip */}
      {showTypeFilter && (
        <Tabs
          value={currentType}
          onValueChange={(value) => handleFilterChange("type", value)}
        >
          <TabsList className="grid w-full grid-cols-4 h-8 gap-1 p-1 bg-muted">
            {typeFilters.map((f) => (
              <TabsTrigger
                key={f.value}
                value={f.value}
                className="text-xs h-6 px-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {showStatusFilter && (
        <Tabs
          value={currentStatus}
          onValueChange={(value) => handleFilterChange("status", value)}
        >
          <TabsList className="grid w-full grid-cols-4 sm:grid-cols-8 h-8 gap-1 p-1 bg-muted">
            {statusFilters.map((f) => (
              <TabsTrigger
                key={f.value}
                value={f.value}
                className="text-xs h-6 px-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* Count row */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {claims.length > 0
            ? `${claims.length} claim${claims.length !== 1 ? "s" : ""}`
            : "No claims"}
        </p>
      </div>

      {/* Empty */}
      {claims.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card py-12 text-center">
          <p className="text-sm font-medium text-foreground">{emptyMessage}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentStatus !== "all" || currentType !== "all"
              ? "Try clearing your filters"
              : "Submit a claim to get started"}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop dense table */}
          <div className="hidden md:block rounded-md border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">Claim</th>
                  <th className="px-3 py-2 text-left font-medium">Employee</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {claims.map((claim) => {
                  const balance = balanceLabel(claim);
                  return (
                    <tr
                      key={claim._id}
                      className="hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={`/dashboard/claims/${claim._id}`}
                          className="font-mono text-xs text-foreground hover:text-yellow-600"
                        >
                          {claim.claimNumber}
                        </Link>
                        {claim.description && (
                          <p className="mt-0.5 truncate max-w-[28ch] text-xs text-muted-foreground">
                            {claim.description}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        <span className="truncate">{claim.employee?.name}</span>
                      </td>
                      <td className="px-3 py-2">
                        <ClaimTypeBadge claimType={claim.claimType} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">
                        {formatCurrency(claim.totalAmount)}
                        {balance && (
                          <p className={`mt-0.5 text-[11px] ${balance.tone}`}>
                            {balance.text}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <ClaimStatusBadge status={claim.status} />
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {formatWhen(claim.claimDate)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile slim card list */}
          <div className="md:hidden divide-y divide-border rounded-md border border-border bg-card">
            {claims.map((claim) => {
              const balance = balanceLabel(claim);
              return (
                <Link
                  key={claim._id}
                  href={`/dashboard/claims/${claim._id}`}
                  className="block p-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs text-foreground">
                        {claim.claimNumber}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-foreground">
                        {claim.employee?.name}
                      </p>
                      {claim.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {claim.description}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-medium text-foreground">
                        {formatCurrency(claim.totalAmount)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatWhen(claim.claimDate)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ClaimTypeBadge claimType={claim.claimType} />
                    <ClaimStatusBadge status={claim.status} />
                    {balance && (
                      <span className={`text-[11px] ${balance.tone}`}>
                        {balance.text}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function ClaimsListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-3 w-24" />
      <div className="rounded-md border border-border bg-card">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0"
          >
            <div className="space-y-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

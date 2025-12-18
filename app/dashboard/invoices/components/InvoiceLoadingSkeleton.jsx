import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function InvoicesLoadingCompact() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-5 w-64" />
        </div>
      </div>

      {/* Stats Cards - 2 cols mobile, 4 cols desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Invoices */}
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
            <Skeleton className="h-8 w-12 mb-3" />
            <div className="pt-2 border-t border-border">
              <Skeleton className="h-3 w-16 mb-1" />
              <Skeleton className="h-4 w-20" />
            </div>
          </CardContent>
        </Card>

        {/* Paid */}
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
            <Skeleton className="h-8 w-12 mb-3" />
            <div className="pt-2 border-t border-border">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>

        {/* Unpaid */}
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
            <Skeleton className="h-8 w-12 mb-3" />
            <div className="pt-2 border-t border-border">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>

        {/* Partial */}
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
            <Skeleton className="h-8 w-12 mb-3" />
            <div className="pt-2 border-t border-border">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-12" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search */}
            <Skeleton className="h-10 w-full" />

            {/* Filter Row 1 */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 sm:max-w-45 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="flex-1 sm:max-w-45 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>

            {/* Date Range Row */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Desktop Table */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {/* Header */}
            <div className="bg-muted/50 border-b">
              <div className="flex items-center gap-4 p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>

            {/* Rows */}
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="border-b hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4 p-4">
                  <Skeleton className="h-4 w-24" />
                  <div className="min-w-[180px]">
                    <Skeleton className="h-4 w-32 mb-1" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-8 w-8 rounded" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="space-y-3">
                {/* Top Row */}
                <div className="flex items-start justify-between">
                  <div>
                    <Skeleton className="h-5 w-28 mb-1" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>

                {/* Customer */}
                <div>
                  <Skeleton className="h-3 w-16 mb-1" />
                  <Skeleton className="h-4 w-32 mb-1" />
                  <Skeleton className="h-3 w-40" />
                </div>

                {/* Grid Info */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Skeleton className="h-3 w-16 mb-1" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div>
                    <Skeleton className="h-3 w-12 mb-1" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>

                {/* Payment Status */}
                <div>
                  <Skeleton className="h-3 w-24 mb-1" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-9 flex-1" />
                  <Skeleton className="h-9 w-9 rounded" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <div className="inline-flex gap-2">
          {[...Array(7)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-10 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

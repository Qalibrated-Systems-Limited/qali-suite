import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function StockLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <Skeleton className="h-9 w-48 mb-2" /> {/* Title */}
          <Skeleton className="h-5 w-96" /> {/* Description */}
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-32" /> {/* PDF Button */}
          <Skeleton className="h-10 w-24" /> {/* Add Button */}
        </div>
      </div>

      {/* Stats Cards Skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, index) => (
          <Card key={index} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-3 w-20" /> {/* Label */}
                  <Skeleton className="h-8 w-16" /> {/* Count */}
                </div>
                <Skeleton className="h-8 w-8 rounded" /> {/* Icon */}
              </div>
              {index > 0 && (
                <div className="mt-2 pt-2 border-t border-border">
                  <Skeleton className="h-3 w-24" /> {/* Sub text */}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search and Filters Skeleton */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar */}
            <div className="w-full">
              <Skeleton className="h-10 w-full" />
            </div>

            {/* Filters Row */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="space-y-2 flex-1 sm:max-w-[180px]">
                <Skeleton className="h-3 w-16" /> {/* Label */}
                <Skeleton className="h-10 w-full" /> {/* Select */}
              </div>
              <div className="space-y-2 flex-1 sm:max-w-[180px]">
                <Skeleton className="h-3 w-20" /> {/* Label */}
                <Skeleton className="h-10 w-full" /> {/* Select */}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Desktop Table Skeleton */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {/* Table Header */}
            <div className="border-b bg-muted/50 p-4">
              <div className="flex gap-4">
                <Skeleton className="h-4 w-24" /> {/* SKU */}
                <Skeleton className="h-4 w-32" /> {/* Name */}
                <Skeleton className="h-4 w-24" /> {/* Category */}
                <Skeleton className="h-4 w-20" /> {/* Stock */}
                <Skeleton className="h-4 w-20" /> {/* Unit */}
                <Skeleton className="h-4 w-20" /> {/* Price */}
                <Skeleton className="h-4 w-24" /> {/* Location */}
                <Skeleton className="h-4 w-16" /> {/* Actions */}
              </div>
            </div>

            {/* Table Rows */}
            {[...Array(10)].map((_, index) => (
              <div
                key={index}
                className="border-b p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex gap-4 items-center">
                  <Skeleton className="h-4 w-24" /> {/* SKU */}
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-32" /> {/* Name */}
                    <Skeleton className="h-3 w-40" /> {/* Description */}
                  </div>
                  <Skeleton className="h-4 w-24" /> {/* Category */}
                  <Skeleton className="h-6 w-16 rounded-full" />{" "}
                  {/* Stock badge */}
                  <Skeleton className="h-4 w-20" /> {/* Unit */}
                  <Skeleton className="h-4 w-20" /> {/* Price */}
                  <Skeleton className="h-4 w-24" /> {/* Location */}
                  <Skeleton className="h-8 w-8 rounded" /> {/* Actions */}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Mobile Card View Skeleton */}
      <div className="md:hidden space-y-4">
        {[...Array(6)].map((_, index) => (
          <Card key={index} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-5 w-32" /> {/* Name */}
                    <Skeleton className="h-4 w-24" /> {/* SKU */}
                  </div>
                  <Skeleton className="h-6 w-20 rounded-full" />{" "}
                  {/* Stock badge */}
                </div>

                {/* Details */}
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full" /> {/* Description */}
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-16" /> {/* Label */}
                    <Skeleton className="h-4 w-20" /> {/* Value */}
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-16" /> {/* Label */}
                    <Skeleton className="h-4 w-24" /> {/* Value */}
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-12" /> {/* Label */}
                    <Skeleton className="h-4 w-16" /> {/* Value */}
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-16" /> {/* Label */}
                    <Skeleton className="h-4 w-20" /> {/* Value */}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-9 flex-1" /> {/* Button */}
                  <Skeleton className="h-9 w-9 rounded" /> {/* Icon button */}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination Skeleton */}
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

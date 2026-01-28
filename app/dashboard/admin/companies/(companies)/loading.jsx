import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function CompaniesLoading() {
  return (
    <div className="container py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48 mt-1" />
          </div>
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <div className="space-y-4">
        <div className="flex gap-3">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="border rounded-lg p-4 space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24 mt-1" />
              </div>
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

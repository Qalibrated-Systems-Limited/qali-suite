import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdjustmentsLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-9 w-64 bg-muted" />
          <Skeleton className="h-4 w-96 bg-muted" />
        </div>
        <Skeleton className="h-10 w-40 bg-muted" />
      </div>

      {/* Stats Cards Skeleton */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-32 bg-muted" />
              <Skeleton className="h-4 w-4 bg-muted rounded-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20 bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Content Skeleton */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <div className="space-y-4">
            <Skeleton className="h-4 w-full bg-muted" />
            <Skeleton className="h-4 w-3/4 bg-muted" />
            <Skeleton className="h-4 w-5/6 bg-muted" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

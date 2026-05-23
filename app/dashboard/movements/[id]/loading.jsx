import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function MovementDetailLoading() {
  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-36" />
        <span className="text-muted-foreground">/</span>
        <Skeleton className="h-4 w-40" />
      </div>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </div>

      {/* Two-column cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {[1, 2].map((i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="p-4 space-y-4">
              {[1, 2].map((j) => (
                <div key={j} className="space-y-3">
                  <Skeleton className="h-4 w-40" />
                  <div className="p-4 bg-muted/50 rounded-lg border border-border">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {[1, 2, 3, 4].map((k) => (
                        <div key={k} className="space-y-1">
                          <Skeleton className="h-3 w-20" />
                          <Skeleton className="h-4 w-28" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Timeline */}
      <Card className="bg-card border-border">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="p-4 bg-muted/50 rounded-lg border border-border space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-44" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

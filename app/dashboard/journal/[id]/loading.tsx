import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function JournalDetailLoading() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Back button + Header */}
      <div className="space-y-4">
        <Skeleton className="h-8 w-24" />
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="h-5 w-64" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-3 sm:p-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-7 w-20" />
            </div>
          </Card>
        ))}
      </div>

      {/* Journal Lines */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="divide-y">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4 flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
        <div className="p-4 border-t bg-muted/50">
          <div className="flex justify-end gap-8">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-6 w-28" />
          </div>
        </div>
      </Card>

      {/* Details & Audit Trail */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="p-4 space-y-4">
          <Skeleton className="h-6 w-24" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4 space-y-4">
          <Skeleton className="h-6 w-28" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

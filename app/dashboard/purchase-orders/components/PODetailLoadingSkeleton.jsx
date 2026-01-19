import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

export default function PODetailLoadingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        {/* Back link */}
        <Skeleton className="h-4 w-40" />

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <Skeleton className="h-9 w-36" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-52" />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-20" />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - PO Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Details Card */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-5 w-28" />
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-6">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-2">
                      <Skeleton className="h-4 w-4" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <Skeleton className="h-5 w-28" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-5 w-20" />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {/* Table Header */}
              <div className="hidden sm:block overflow-x-auto">
                <div className="bg-muted/50 border-b px-4 py-3">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-4 w-6" />
                    <Skeleton className="h-4 w-28 flex-1" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </div>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="border-b px-4 py-4">
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-4 w-6" />
                      <div className="flex-1">
                        <Skeleton className="h-4 w-40 mb-1" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-4 w-12" />
                      <Skeleton className="h-4 w-12" />
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-12" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  </div>
                ))}
              </div>

              {/* Mobile Cards */}
              <div className="sm:hidden space-y-3 p-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="bg-muted/50 rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <Skeleton className="h-4 w-36 mb-1" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <div className="flex justify-between text-sm">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b">
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div>
                <Skeleton className="h-3 w-28 mb-2" />
                <Skeleton className="h-4 w-full mb-1" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Summary */}
        <div className="space-y-6">
          {/* Supplier Card */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-5 w-16" />
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              <Skeleton className="h-6 w-36" />
              <Separator />
              <div>
                <Skeleton className="h-3 w-16 mb-1" />
                <Skeleton className="h-4 w-28" />
              </div>
              <div>
                <Skeleton className="h-3 w-12 mb-1" />
                <Skeleton className="h-4 w-36" />
              </div>
              <div>
                <Skeleton className="h-3 w-14 mb-1" />
                <Skeleton className="h-4 w-24" />
              </div>
            </CardContent>
          </Card>

          {/* Order Summary */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-5 w-28" />
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Separator />
              <div className="flex justify-between">
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-6 w-28" />
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b">
              <Skeleton className="h-5 w-16" />
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>

          {/* Activity */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b">
              <Skeleton className="h-5 w-16" />
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="h-4 w-4 mt-0.5" />
                  <div>
                    <Skeleton className="h-4 w-24 mb-1" />
                    <Skeleton className="h-3 w-20 mb-1" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditBillLoading() {
  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="border-b bg-card/50">
        <div className="container max-w-4xl py-4 sm:py-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-8 w-8 rounded" />
            <div className="space-y-1">
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 container max-w-4xl py-6 sm:py-8 space-y-6">
        {/* Supplier & Dates Card */}
        <Card>
          <CardHeader className="border-b">
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Line Items Card */}
        <Card>
          <CardHeader className="border-b flex flex-row items-center justify-between">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-9 w-24" />
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="rounded-lg border p-4 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-8 w-8" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-10 w-full" />
                </div>
                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* WHT Card */}
        <Card>
          <CardHeader className="border-b">
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-5 w-5" />
              <Skeleton className="h-4 w-32" />
            </div>
          </CardContent>
        </Card>

        {/* Notes Card */}
        <Card>
          <CardHeader className="border-b">
            <Skeleton className="h-6 w-16" />
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-20 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-20 w-full" />
            </div>
          </CardContent>
        </Card>

        {/* Submit Button */}
        <div className="flex justify-end gap-3 pt-4">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    </div>
  );
}

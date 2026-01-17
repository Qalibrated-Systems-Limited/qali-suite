import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

export default function AccountDetailLoading() {
  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 w-full sm:w-auto">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href="/dashboard/accounts">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-20" />
            </div>
            <Skeleton className="h-7 w-48" />
          </div>
        </div>

        {/* Action Buttons Skeleton */}
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Main Content - Left Side */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          {/* Balance Card Skeleton */}
          <Card className="border-2">
            <CardHeader className="pb-3">
              <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Skeleton className="h-4 w-32 mb-2" />
                  <Skeleton className="h-12 w-56" />
                </div>
                <div className="pt-3 border-t border-border">
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Account Details Skeleton */}
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-20" />
                </div>

                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-16" />
                </div>

                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-20" />
                </div>

                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-6 w-12" />
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </CardContent>
          </Card>

          {/* Recent Transactions Skeleton */}
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-muted/50"
                  >
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="space-y-1 text-right">
                        <Skeleton className="h-3 w-12" />
                        <Skeleton className="h-5 w-24" />
                      </div>
                    </div>
                  </div>
                ))}

                <Skeleton className="h-10 w-full" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Right Side */}
        <div className="space-y-4 sm:space-y-6">
          {/* Quick Stats Skeleton */}
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-24" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-16" />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-6 w-16" />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-20" />
              </div>
            </CardContent>
          </Card>

          {/* Metadata Skeleton */}
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-24" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-32" />
              </div>

              <Separator />

              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-28" />
              </div>

              <Separator />

              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
              </div>

              <Separator />

              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions Skeleton */}
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-28" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

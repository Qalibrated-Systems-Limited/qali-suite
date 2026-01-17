import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PartyListLoading() {
  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header Skeleton */}
      <div className="space-y-1 sm:space-y-2">
        <Skeleton className="h-8 sm:h-10 w-32" />
        <Skeleton className="h-4 sm:h-5 w-64" />
      </div>

      {/* Tabs Skeleton */}
      <div className="border-b border-border">
        <div className="flex gap-2 sm:gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-24" />
          ))}
        </div>
      </div>

      {/* ============================================
          DESKTOP TABLE SKELETON
          ============================================ */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-6 py-3 text-left">
                    <Skeleton className="h-4 w-20" />
                  </th>
                  <th className="px-6 py-3 text-left">
                    <Skeleton className="h-4 w-16" />
                  </th>
                  <th className="px-6 py-3 text-left">
                    <Skeleton className="h-4 w-24" />
                  </th>
                  <th className="px-6 py-3 text-left">
                    <Skeleton className="h-4 w-20" />
                  </th>
                  <th className="px-6 py-3 text-right">
                    <Skeleton className="h-4 w-20 ml-auto" />
                  </th>
                  <th className="px-6 py-3 text-center">
                    <Skeleton className="h-4 w-16 mx-auto" />
                  </th>
                  <th className="px-6 py-3 text-right">
                    <Skeleton className="h-4 w-20 ml-auto" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    <td className="px-6 py-4">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton className="h-6 w-20 rounded-full" />
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <Skeleton className="h-3 w-40" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Skeleton className="h-4 w-24 ml-auto" />
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton className="h-6 w-16 rounded-full mx-auto" />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Skeleton className="h-8 w-8 rounded" />
                        <Skeleton className="h-8 w-8 rounded" />
                        <Skeleton className="h-8 w-8 rounded" />
                        <Skeleton className="h-8 w-8 rounded" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ============================================
          MOBILE CARD SKELETON
          ============================================ */}
      <div className="space-y-4 md:hidden">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>

                {/* Type Badge */}
                <Skeleton className="h-6 w-20 rounded-full" />

                {/* Contact Info */}
                <div className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-36" />
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-9 flex-1" />
                  <Skeleton className="h-9 flex-1" />
                  <Skeleton className="h-9 w-9" />
                  <Skeleton className="h-9 w-9" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination Skeleton */}
      <div className="flex justify-center mt-4">
        <div className="flex gap-2">
          <Skeleton className="h-10 w-10 rounded" />
          <Skeleton className="h-10 w-10 rounded" />
          <Skeleton className="h-10 w-10 rounded" />
          <Skeleton className="h-10 w-10 rounded" />
        </div>
      </div>
    </div>
  );
}

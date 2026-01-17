import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function BillDetailLoading() {
  return (
    <div className="space-y-6">
      {/* Back button */}
      <Skeleton className="h-8 w-32" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="h-5 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-9 w-16" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Bill Details Card */}
          <Card>
            <CardHeader className="border-b">
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-6">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-5 w-32" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Line Items Card */}
          <Card>
            <CardHeader className="border-b">
              <Skeleton className="h-6 w-36" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      {["#", "Description", "Account", "Qty", "Price", "VAT", "Total"].map(
                        (header) => (
                          <th
                            key={header}
                            className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase"
                          >
                            {header}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[1, 2, 3].map((i) => (
                      <tr key={i}>
                        <td className="px-4 py-4">
                          <Skeleton className="h-4 w-4" />
                        </td>
                        <td className="px-4 py-4">
                          <Skeleton className="h-5 w-48" />
                          <Skeleton className="h-3 w-32 mt-1" />
                        </td>
                        <td className="px-4 py-4">
                          <Skeleton className="h-4 w-16" />
                          <Skeleton className="h-3 w-24 mt-1" />
                        </td>
                        <td className="px-4 py-4">
                          <Skeleton className="h-4 w-12" />
                        </td>
                        <td className="px-4 py-4">
                          <Skeleton className="h-4 w-20" />
                        </td>
                        <td className="px-4 py-4">
                          <Skeleton className="h-4 w-12" />
                        </td>
                        <td className="px-4 py-4">
                          <Skeleton className="h-4 w-24" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Supplier Card */}
          <Card>
            <CardHeader className="border-b">
              <Skeleton className="h-6 w-24" />
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-6 w-40" />
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Payment Summary Card */}
          <Card>
            <CardHeader className="border-b">
              <Skeleton className="h-6 w-36" />
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex justify-between">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
              <Skeleton className="h-12 w-full rounded-lg" />
            </CardContent>
          </Card>

          {/* Actions Card */}
          <Card>
            <CardHeader className="border-b">
              <Skeleton className="h-6 w-20" />
            </CardHeader>
            <CardContent className="p-6 space-y-2">
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

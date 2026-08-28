import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  ClipboardList,
  Eye,
  EyeOff,
  Plus,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import { listStockCountsPg } from "@/app/db/actions/stock-count-actions";
import { formatDate } from "@/lib/pdf";

export const STATUS_STYLES = {
  draft: "bg-muted text-muted-foreground border-border",
  counting: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  review: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  posted: "bg-green-500/10 text-green-600 border-green-500/20",
  cancelled: "bg-red-500/10 text-red-600 border-red-500/20",
};

export const STATUS_LABELS = {
  draft: "Draft",
  counting: "Counting",
  review: "In review",
  posted: "Posted",
  cancelled: "Cancelled",
};

// ============================================
// STATS
// ============================================

export async function StockCountStatsCards() {
  const rows = await listStockCountsPg({ limit: 200 });

  const open = rows.filter((r) => r.status === "counting").length;
  const inReview = rows.filter((r) => r.status === "review").length;
  const posted = rows.filter((r) => r.status === "posted").length;
  // Only sheets still open can have work left on them; a posted one is done
  // whatever its variance count says.
  const outstanding = rows
    .filter((r) => r.status === "counting")
    .reduce((sum, r) => sum + (r.lineCount - r.countedLines), 0);

  const tiles = [
    { label: "Being counted", value: open, hint: "sheets open", icon: ScanLine },
    {
      label: "Awaiting review",
      value: inReview,
      hint: "counted, not posted",
      icon: TriangleAlert,
    },
    {
      label: "Lines to count",
      value: outstanding,
      hint: "across open sheets",
      icon: ClipboardList,
    },
    { label: "Posted", value: posted, hint: "all time", icon: ClipboardList },
  ];

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {tiles.map(({ label, value, hint, icon: Icon }) => (
        <Card key={label} className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
              {label}
            </CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-foreground">
              {value}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{hint}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function StockCountStatsSkeleton() {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i} className="bg-card border-border">
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-24 bg-muted" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-7 w-12 bg-muted" />
            <Skeleton className="h-3 w-20 bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================
// THE LIST
// ============================================

export async function StockCountsTableServer({ status }) {
  const counts = await listStockCountsPg({
    status: status && status !== "all" ? status : undefined,
    limit: 50,
  });

  if (counts.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-12 text-center space-y-3">
          <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No stock counts yet. A count freezes what the book says, records
            what is on the shelf, and posts the difference as one adjustment.
          </p>
          <Button asChild size="sm">
            <Link href="/dashboard/stock-counts/create">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Start a count
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left p-4 text-xs font-medium text-muted-foreground">
                Count
              </th>
              <th className="text-left p-4 text-xs font-medium text-muted-foreground">
                Date
              </th>
              <th className="text-left p-4 text-xs font-medium text-muted-foreground">
                Progress
              </th>
              <th className="text-center p-4 text-xs font-medium text-muted-foreground">
                Variances
              </th>
              <th className="text-center p-4 text-xs font-medium text-muted-foreground">
                Status
              </th>
              <th className="text-left p-4 text-xs font-medium text-muted-foreground">
                Opened by
              </th>
            </tr>
          </thead>
          <tbody>
            {counts.map((count) => (
              <tr
                key={count.id}
                className="border-b border-border hover:bg-muted/30 transition-colors"
              >
                <td className="p-4">
                  <Link
                    href={`/dashboard/stock-counts/${count.id}`}
                    className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                  >
                    {count.countNumber}
                  </Link>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    {count.isBlind ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                    {count.name}
                  </p>
                </td>
                <td className="p-4 text-sm text-muted-foreground">
                  {formatDate(count.countDate)}
                </td>
                <td className="p-4">
                  {count.lineCount === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      Sheet not generated
                    </span>
                  ) : (
                    <div className="space-y-1 min-w-[7rem]">
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{
                            width: `${Math.round((count.countedLines / count.lineCount) * 100)}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {count.countedLines} of {count.lineCount} counted
                      </p>
                    </div>
                  )}
                </td>
                <td className="p-4 text-center">
                  {count.countedLines === 0 ? (
                    <span className="text-sm text-muted-foreground">—</span>
                  ) : count.varianceLines > 0 ? (
                    <span className="text-sm font-medium text-yellow-600">
                      {count.varianceLines}
                    </span>
                  ) : (
                    <span className="text-sm text-green-600">none</span>
                  )}
                </td>
                <td className="p-4 text-center">
                  <Badge
                    variant="outline"
                    className={STATUS_STYLES[count.status]}
                  >
                    {STATUS_LABELS[count.status] ?? count.status}
                  </Badge>
                </td>
                <td className="p-4 text-sm text-muted-foreground">
                  {count.createdByName}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function StockCountsTableSkeleton() {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}

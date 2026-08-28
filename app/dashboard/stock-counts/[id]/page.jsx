import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { canSeeInventoryNav } from "@/lib/permissions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Info } from "lucide-react";
import { getStockCountPg } from "@/app/db/actions/stock-count-actions";
import { CountSheet } from "../components/CountSheet";
import {
  STATUS_LABELS,
  STATUS_STYLES,
} from "../components/StockCountServerComponents";
import { formatCurrency } from "@/lib/utils/erp-utils";
import { formatDate } from "@/lib/pdf";

export default async function StockCountDetailPage({ params }) {
  const session = await auth();
  const { user } = session;

  if (!canSeeInventoryNav(user?.role)) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">Stock Count</h1>
        <Alert className="bg-destructive/10 border-destructive/20">
          <Info className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-destructive text-xs sm:text-sm">
            You don&apos;t have permission to view stock counts.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { id } = await params;
  const count = await getStockCountPg(id);
  if (!count) return notFound();

  const hideExpected = count.isBlind && count.status === "counting";

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/stock-counts"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Stock counts
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">
              {count.countNumber}
            </h1>
            <Badge variant="outline" className={STATUS_STYLES[count.status]}>
              {STATUS_LABELS[count.status] ?? count.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {count.name} · {formatDate(count.countDate)}
            {count.frozenAt ? ` · frozen ${formatDate(count.frozenAt)}` : ""}
          </p>
        </div>

        {count.adjustmentId && (
          <Link
            href={`/dashboard/adjustments`}
            className="text-sm text-primary hover:underline"
          >
            View the adjustment it raised →
          </Link>
        )}
      </div>

      {/* The variance summary is withheld during a blind count for the same
          reason the expected quantity is: it would give the answer away. */}
      {!hideExpected && count.countedLines > 0 && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <SummaryTile
            label="Counted"
            value={`${count.countedLines} / ${count.lineCount}`}
            hint="lines"
          />
          <SummaryTile
            label="Variances"
            value={count.varianceLines}
            hint={`${count.overLines} over · ${count.shortLines} short`}
          />
          <SummaryTile
            label="Net variance"
            value={formatCurrency(Number(count.netVarianceValue))}
            hint={
              Number(count.netVarianceValue) < 0
                ? "book overstated"
                : Number(count.netVarianceValue) > 0
                  ? "book understated"
                  : "book agrees"
            }
          />
          <SummaryTile
            label="Value counted"
            value={formatCurrency(Number(count.frozenValue))}
            hint="at the frozen cost"
          />
        </div>
      )}

      <CountSheet count={count} />
    </div>
  );
}

function SummaryTile({ label, value, hint }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-5 pb-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-lg sm:text-xl font-bold text-foreground mt-1 tabular-nums">
          {value}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </CardContent>
    </Card>
  );
}

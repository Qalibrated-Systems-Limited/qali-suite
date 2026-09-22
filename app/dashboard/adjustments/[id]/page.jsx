import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Package, TrendingUp, TrendingDown } from "lucide-react";

import { getAdjustmentById } from "@/app/db/actions/adjustment-actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/capabilities";
import AdjustmentApprovalActions from "../components/AdjustmentApprovalActions";

/**
 * One stock adjustment, in full.
 *
 * THE LIST LINKED HERE AND THE ROUTE DID NOT EXIST. Both the table row and the
 * phone card have pointed at `/dashboard/adjustments/<id>` since the module was
 * ported, so every adjustment number on the register was a 404 — the count, the
 * value and the status were visible, and the lines behind them were not.
 *
 * The data was already there: `getAdjustmentById` and the repository's
 * `getAdjustment` were written and had no caller. This is the page.
 *
 * WHAT IT SHOWS, and why the line table is the point: an adjustment is a
 * statement that the system's figure was wrong, so what a reader needs is the
 * system quantity, the counted quantity, the difference and what that
 * difference was worth — per product, at the cost used on the day. The header
 * figures are the same three the register shows, so a person arriving from it
 * sees the number they clicked.
 */

export const metadata = {
  title: "Stock Adjustment | ERP System",
};

const STATUS_STYLES = {
  draft: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  approved: "bg-green-500/10 text-green-600 border-green-500/20",
  cancelled: "bg-red-500/10 text-red-600 border-red-500/20",
};

const money = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 }).format(
    Number(n) || 0,
  );

const qty = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 4 }).format(
    Number(n) || 0,
  );

const formatDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-KE", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

function Figure({ label, value, tone }) {
  return (
    <div className="min-w-0 bg-card px-3 py-2.5 sm:px-4">
      <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`truncate text-base font-semibold sm:text-lg ${tone ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

export default async function AdjustmentDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const adjustment = await getAdjustmentById(id);
  if (!adjustment) notFound();

  const lines = adjustment.lines ?? [];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 h-8 w-fit px-2">
        <Link href="/dashboard/adjustments">
          <ChevronLeft className="mr-1 h-4 w-4" />
          Stock adjustments
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground sm:text-sm">
              {adjustment.adjustmentNumber}
            </span>
            <Badge variant="outline" className={STATUS_STYLES[adjustment.status]}>
              {adjustment.status}
            </Badge>
            {adjustment.adjustmentType && (
              <Badge variant="outline" className="text-xs">
                {String(adjustment.adjustmentType).replace(/_/g, " ")}
              </Badge>
            )}
          </div>
          <h1 className="text-xl font-semibold break-words text-foreground sm:text-2xl">
            {formatDate(adjustment.adjustmentDate)}
          </h1>
          {/* `description` is the header's own text; `reason` lives on each
              LINE, which is where the count sheet explains itself. */}
          {adjustment.description && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {adjustment.description}
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Raised by {adjustment.createdByName || adjustment.createdBy?.name || "—"}
            {adjustment.referenceNumber ? ` · ref ${adjustment.referenceNumber}` : ""}
            {adjustment.approvedByName ? ` · approved by ${adjustment.approvedByName}` : ""}
          </p>
          {adjustment.status === "cancelled" && adjustment.cancellationReason && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-500">
              Cancelled: {adjustment.cancellationReason}
            </p>
          )}
        </div>

        {/*
          THE DRAFT'S WAY OUT. An approver could see a draft and do nothing
          with it: both actions existed and no screen called either, so drafts
          accumulated and the stock they correct stayed wrong. Only a draft
          offers them — an approved adjustment has already posted, and a
          cancelled one is finished.
        */}
        {adjustment.status === "draft" && (
          <AdjustmentApprovalActions
            adjustmentId={adjustment._id}
            canApprove={can(session.user.role, "adjustment.approve")}
          />
        )}
      </div>

      {/* The register's own three figures, so the number clicked is the number
          shown. */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          <Figure label="Lines" value={lines.length} />
          <Figure
            label="Increase"
            value={`KES ${money(adjustment.totalIncreaseValue)}`}
            tone="text-emerald-600 dark:text-emerald-500"
          />
          <Figure
            label="Decrease"
            value={`KES ${money(adjustment.totalDecreaseValue)}`}
            tone="text-red-600 dark:text-red-500"
          />
          <Figure
            label="Net"
            value={`KES ${money(adjustment.totalAdjustmentValue)}`}
          />
        </div>
      </Card>

      {adjustment.notes && (
        <Card className="p-4 sm:p-5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Notes
          </p>
          <p className="mt-1 text-sm">{adjustment.notes}</p>
        </Card>
      )}

      {/* PHONE — one card per line, because a six-column table on a 360px
          screen is worse than either. */}
      <div className="flex flex-col gap-2 md:hidden">
        {lines.map((line, i) => (
          <Card key={line.id ?? i} className="space-y-2 p-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug">
                {line.productName}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {line.productSKU}
                {line.productUnit ? ` · ${line.productUnit}` : ""}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm tabular-nums">
              <span className="text-muted-foreground">
                {qty(line.systemQuantity)} → {qty(line.physicalQuantity)}
              </span>
              <span
                className={
                  line.adjustmentQuantity < 0
                    ? "text-red-600 dark:text-red-500"
                    : "text-emerald-600 dark:text-emerald-500"
                }
              >
                {line.adjustmentQuantity > 0 ? "+" : ""}
                {qty(line.adjustmentQuantity)} · KES {money(line.adjustmentValue)}
              </span>
            </div>
          </Card>
        ))}
      </div>

      {/* From md up, the register's own table. */}
      <Card className="hidden overflow-x-auto p-0 md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Product</th>
              <th className="px-3 py-2 text-left font-medium">Unit</th>
              <th className="px-3 py-2 text-right font-medium">System</th>
              <th className="px-3 py-2 text-right font-medium">Counted</th>
              <th className="px-3 py-2 text-right font-medium">Difference</th>
              <th className="px-3 py-2 text-right font-medium">Unit cost</th>
              <th className="px-3 py-2 text-right font-medium">Value (KES)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={line.id ?? i} className="border-t border-border">
                <td className="px-3 py-2.5">
                  <span className="font-medium">{line.productName}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {line.productSKU}
                  </span>
                  {line.reason && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {String(line.reason).replace(/_/g, " ")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {line.productUnit || "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {qty(line.systemQuantity)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {qty(line.physicalQuantity)}
                </td>
                <td
                  className={`px-3 py-2.5 text-right tabular-nums ${
                    line.adjustmentQuantity < 0
                      ? "text-red-600 dark:text-red-500"
                      : "text-emerald-600 dark:text-emerald-500"
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {line.adjustmentQuantity < 0 ? (
                      <TrendingDown className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingUp className="h-3.5 w-3.5" />
                    )}
                    {line.adjustmentQuantity > 0 ? "+" : ""}
                    {qty(line.adjustmentQuantity)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {money(line.unitCost)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {money(line.adjustmentValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {lines.length === 0 && (
        <Card className="flex flex-col items-center justify-center px-4 py-10 text-center">
          <Package className="mb-3 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            This adjustment has no lines.
          </p>
        </Card>
      )}
    </div>
  );
}

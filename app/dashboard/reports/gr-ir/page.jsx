import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { canSeePurchasesNav } from "@/lib/permissions";
import { getGrIrOpenItemsPg } from "@/app/db/actions/grn-actions";
import { ReportSkeleton } from "../components/ReportSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { AlertTriangle, PackageCheck, ReceiptText } from "lucide-react";

export const metadata = {
  title: "GR/IR Reconciliation | Reports",
  description:
    "Goods received not invoiced, and invoiced not received — every open position in the clearing account",
};

/**
 * GR/IR — goods received, not invoiced.
 *
 * The report that could not exist until procurement moved. GR/IR is the
 * clearing account between the warehouse and the ledger: receiving debits
 * Inventory and credits it; billing debits it and credits the supplier. Every
 * order line where the value RECEIVED and the value BILLED disagree is an open
 * position, and the balance of the account should equal the sum of this list.
 *
 * Before the port half the evidence was in the other store — the receipt posted
 * its side into MongoDB while the bill posted into Postgres — so the account
 * could only accumulate and nothing could say why. See §9G.
 */
async function GrIrReport() {
  const items = await getGrIrOpenItemsPg();

  const uninvoiced = items.filter((i) => Number(i.uninvoiced_value) > 0);
  const unreceived = items.filter((i) => Number(i.uninvoiced_value) < 0);
  const net = items.reduce((sum, i) => sum + Number(i.uninvoiced_value), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">GR/IR Reconciliation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every purchase order line where what arrived and what was invoiced
          disagree. The GR/IR clearing account should equal the net below.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Received, not invoiced"
          hint="Goods are here; the supplier has not billed"
          value={uninvoiced.reduce((s, i) => s + Number(i.uninvoiced_value), 0)}
          count={uninvoiced.length}
          icon={PackageCheck}
          tone="text-amber-600 dark:text-amber-400"
        />
        <SummaryCard
          label="Invoiced, not received"
          hint="Billed and accepted; the goods have not arrived"
          value={Math.abs(
            unreceived.reduce((s, i) => s + Number(i.uninvoiced_value), 0),
          )}
          count={unreceived.length}
          icon={ReceiptText}
          tone="text-blue-600 dark:text-blue-400"
        />
        <SummaryCard
          label="Net clearing balance"
          hint="What the GR/IR account should show"
          value={net}
          count={items.length}
          icon={AlertTriangle}
          tone="text-foreground"
        />
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="border-b">
          <CardTitle className="text-base">Open positions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Nothing outstanding — every accepted receipt has been invoiced,
              and every invoice has its goods.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Supplier</th>
                    <th className="px-4 py-3 font-medium">Line</th>
                    <th className="px-4 py-3 font-medium text-right">Ordered</th>
                    <th className="px-4 py-3 font-medium text-right">Accepted</th>
                    <th className="px-4 py-3 font-medium text-right">Billed</th>
                    <th className="px-4 py-3 font-medium text-right">Open value</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const value = Number(i.uninvoiced_value);
                    return (
                      <tr
                        key={i.purchase_order_line_id}
                        className="border-b last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboard/purchase-orders/${i.purchase_order_id}`}
                            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {i.po_number}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{i.supplier_name}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {i.description}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {Number(i.ordered_quantity)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {Number(i.accepted_quantity)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {Number(i.billed_quantity)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Badge
                            variant="outline"
                            className={
                              value > 0
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20"
                                : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20"
                            }
                          >
                            {formatCurrency(Math.abs(value))}
                            <span className="ml-1 opacity-70">
                              {value > 0 ? "GRNI" : "IRNG"}
                            </span>
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, hint, value, count, icon: Icon, tone }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-xl font-bold ${tone}`}>{formatCurrency(value)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {count} {count === 1 ? "line" : "lines"} · {hint}
            </p>
          </div>
          <Icon className={`h-5 w-5 shrink-0 ${tone}`} />
        </div>
      </CardContent>
    </Card>
  );
}

export default async function GrIrPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeePurchasesNav(session.user.role)) redirect("/dashboard");

  return (
    <Suspense fallback={<ReportSkeleton />}>
      <GrIrReport />
    </Suspense>
  );
}

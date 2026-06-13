import Link from "next/link";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { canSeeSalesNav } from "@/lib/permissions";
import { ArrowLeft, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cSalesOrder } from "@/app/mongodb/queries/sales-order-queries";
import { getCompanyById } from "@/app/mongodb/queries/company-queries";
import { serializeBsonType } from "@/lib/utils";
import AccessDenied from "@/app/dashboard/components/crm/AccessDenied";
import SalesOrderActions from "../components/SalesOrderActions";
import { SalesOrderPDFButton } from "../components/SalesOrderPDFButton";

export const dynamic = "force-dynamic";

const STATUS_STYLES = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-500/10 text-blue-600",
  invoiced: "bg-emerald-500/10 text-emerald-600",
  cancelled: "bg-destructive/10 text-destructive",
};

const KES = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-KE", { dateStyle: "medium" })
    : "—";

export default async function SalesOrderDetailPage({ params }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeSalesNav(session.user.role))
    return <AccessDenied resource="sales orders" />;

  const { id } = await params;
  const order = await cSalesOrder(id);
  if (!order) notFound();

  // Company header for the PDF (logo, address, PIN).
  let company = null;
  if (session.user.companyId) {
    const c = await getCompanyById(session.user.companyId);
    if (c) company = serializeBsonType(c);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/sales-orders"
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {order.orderNumber}
            </h1>
            <p className="text-xs text-muted-foreground">
              {order.customer.name} · {fmtDate(order.orderDate)}
            </p>
          </div>
        </div>
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
            STATUS_STYLES[order.status] || "bg-muted"
          }`}
        >
          {order.status}
        </span>
      </div>

      {/* Lifecycle actions + PDF */}
      <div className="flex flex-wrap items-center gap-2">
        <SalesOrderActions orderId={order._id} status={order.status} />
        <SalesOrderPDFButton order={order} company={company} />
      </div>

      {/* Provenance */}
      {(order.quoteRef || order.invoiceRef) && (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-wrap gap-4 p-4 text-sm">
            {order.quoteRef && (
              <span>
                From quote{" "}
                <Link
                  href={`/dashboard/quotes/${order.quoteRef.quoteId}`}
                  className="font-medium text-primary hover:underline"
                >
                  {order.quoteRef.quoteNumber}
                </Link>
              </span>
            )}
            {order.invoiceRef && (
              <span>
                Invoiced as{" "}
                <Link
                  href={`/dashboard/invoices/${order.invoiceRef.invoiceId}`}
                  className="font-medium text-primary hover:underline"
                >
                  {order.invoiceRef.invoiceNumber}
                </Link>
              </span>
            )}
            {order.status === "cancelled" && order.cancellationReason && (
              <span className="text-muted-foreground">
                Cancelled: {order.cancellationReason}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {/* Lines */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-sm">Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Mobile: one card per line (house pattern) */}
          <div className="space-y-3 p-4 md:hidden">
            {order.items.map((i) => (
              <div
                key={i._id}
                className="rounded-md border border-border/60 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium leading-snug">
                      {i.description}
                    </div>
                    {i.product && (
                      <div className="text-xs text-muted-foreground">
                        {i.product.sku}
                      </div>
                    )}
                  </div>
                  {i.stockCommitted ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-blue-600">
                      <Lock className="h-3 w-3" /> reserved
                    </span>
                  ) : i.invoicedQuantity > 0 ? (
                    <span className="shrink-0 text-xs text-emerald-600">
                      invoiced
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {i.quantity} {i.unit} × {KES(i.unitPrice)}
                  </span>
                  <span className="font-semibold">{KES(i.lineTotal)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Unit price</th>
                  <th className="px-4 py-2 text-right font-medium">Line total</th>
                  <th className="px-4 py-2 font-medium">Stock</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i._id} className="border-b border-border/60">
                    <td className="px-4 py-2 text-muted-foreground">
                      {i.lineNumber}
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{i.description}</div>
                      {i.product && (
                        <div className="text-xs text-muted-foreground">
                          {i.product.sku}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {i.quantity} {i.unit}
                    </td>
                    <td className="px-4 py-2 text-right">{KES(i.unitPrice)}</td>
                    <td className="px-4 py-2 text-right font-medium">
                      {KES(i.lineTotal)}
                    </td>
                    <td className="px-4 py-2">
                      {i.stockCommitted ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                          <Lock className="h-3 w-3" /> reserved
                        </span>
                      ) : i.invoicedQuantity > 0 ? (
                        <span className="text-xs text-emerald-600">invoiced</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end border-t border-border px-4 py-3">
            <div className="w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{KES(order.subtotal)}</span>
              </div>
              {order.taxAmount > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Tax</span>
                  <span>{KES(order.taxAmount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-1 font-semibold">
                <span>Total</span>
                <span>{KES(order.total)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

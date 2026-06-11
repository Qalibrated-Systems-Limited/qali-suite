import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeSalesNav } from "@/lib/permissions";
import {
  cSalesOrders,
  cOrderBacklog,
} from "@/app/mongodb/queries/sales-order-queries";
import { Card, CardContent } from "@/components/ui/card";
import AccessDenied from "@/app/dashboard/components/crm/AccessDenied";

export const metadata = {
  title: "Sales Orders | ERP System",
  description: "Confirmed customer orders awaiting fulfilment and billing",
};

// Auth-gated (session headers) — never statically prerendered.
export const dynamic = "force-dynamic";

const STATUS_STYLES = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-500/10 text-blue-600",
  invoiced: "bg-emerald-500/10 text-emerald-600",
  cancelled: "bg-destructive/10 text-destructive",
};

const KES = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-KE", { dateStyle: "medium" })
    : "—";

export default async function SalesOrdersPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeSalesNav(session.user.role))
    return <AccessDenied resource="sales orders" />;

  const params = await searchParams;
  const status = params?.status || "";

  const [orders, backlog] = await Promise.all([
    cSalesOrders(status),
    cOrderBacklog(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Sales Orders</h1>
          <p className="text-sm text-muted-foreground">
            Confirmed orders reserve stock until they&apos;re invoiced. Create
            one from a sent or accepted quote.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Order backlog
          </div>
          <div className="text-xl font-semibold text-primary">
            {KES(backlog.total)}
          </div>
          <div className="text-xs text-muted-foreground">
            {backlog.count} confirmed order{backlog.count === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {["", "draft", "confirmed", "invoiced", "cancelled"].map((s) => (
          <Link
            key={s || "all"}
            href={s ? `/dashboard/sales-orders?status=${s}` : "/dashboard/sales-orders"}
            className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${
              status === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {s || "All"}
          </Link>
        ))}
      </div>

      {orders.length === 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No sales orders{status ? ` with status “${status}”` : ""} yet. Open
            a sent/accepted quote and choose “Create Sales Order”.
          </CardContent>
        </Card>
      )}

      {/* Mobile: card stack (house pattern — table is hidden md:block) */}
      {orders.length > 0 && (
        <div className="space-y-3 md:hidden">
          {orders.map((o) => (
            <Link
              key={o._id}
              href={`/dashboard/sales-orders/${o._id}`}
              className="block"
            >
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{o.orderNumber}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {o.customer.name}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        STATUS_STYLES[o.status] || "bg-muted"
                      }`}
                    >
                      {o.status}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {fmtDate(o.orderDate)} · {o.itemCount} item
                      {o.itemCount === 1 ? "" : "s"}
                    </span>
                    <span className="font-semibold">{KES(o.total)}</span>
                  </div>
                  {(o.quoteRef || o.invoiceRef) && (
                    <div className="mt-1.5 text-xs text-muted-foreground">
                      {o.quoteRef?.quoteNumber}
                      {o.quoteRef && o.invoiceRef && " · "}
                      {o.invoiceRef?.invoiceNumber}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Desktop: table */}
      {orders.length > 0 && (
        <Card className="hidden bg-card border-border md:block">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Items</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Refs</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o._id} className="border-b border-border/60">
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/sales-orders/${o._id}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {o.orderNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{o.customer.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {fmtDate(o.orderDate)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {o.itemCount}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {KES(o.total)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                            STATUS_STYLES[o.status] || "bg-muted"
                          }`}
                        >
                          {o.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {o.quoteRef && (
                          <Link
                            href={`/dashboard/quotes/${o.quoteRef.quoteId}`}
                            className="text-muted-foreground hover:text-primary hover:underline"
                          >
                            {o.quoteRef.quoteNumber}
                          </Link>
                        )}
                        {o.invoiceRef && (
                          <>
                            {o.quoteRef && <span className="mx-1">·</span>}
                            <Link
                              href={`/dashboard/invoices/${o.invoiceRef.invoiceId}`}
                              className="text-muted-foreground hover:text-primary hover:underline"
                            >
                              {o.invoiceRef.invoiceNumber}
                            </Link>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

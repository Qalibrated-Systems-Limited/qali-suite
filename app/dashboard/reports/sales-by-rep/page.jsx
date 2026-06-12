import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeReportsNav } from "@/lib/permissions";
import { ChevronLeft, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  cSalesByRep,
  cRepInvoices,
} from "@/app/mongodb/queries/rep-sales-queries";

export const metadata = {
  title: "Sales by Rep | Reports",
  description: "Billed revenue per salesperson",
};

export const dynamic = "force-dynamic";

const KES = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const KESc = (n) =>
  `KES ${new Intl.NumberFormat("en-KE", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0)}`;

function monthOptions() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      value: `${d.getFullYear()}-${d.getMonth() + 1}`,
      label: d.toLocaleDateString("en-KE", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

export default async function SalesByRepPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeReportsNav(session.user.role)) redirect("/dashboard");

  const params = await searchParams;
  const period = params?.period || ""; // "" = all time, else "YYYY-M"
  const owner = params?.owner || ""; // employeeId filter for drill-down
  const [year, month] = period ? period.split("-").map(Number) : [null, null];

  const reps = await cSalesByRep(year, month);
  const filtered = owner ? reps.filter((r) => r.employeeId === owner) : reps;
  const ownerRep = owner ? reps.find((r) => r.employeeId === owner) : null;
  const drillDown = owner ? await cRepInvoices(owner, year, month) : [];

  const totals = filtered.reduce(
    (a, r) => ({
      revenue: a.revenue + r.revenue,
      collected: a.collected + r.collected,
      outstanding: a.outstanding + r.outstanding,
      invoices: a.invoices + r.invoices,
    }),
    { revenue: 0, collected: 0, outstanding: 0, invoices: 0 },
  );

  const qs = (p, o) =>
    `/dashboard/reports/sales-by-rep?${new URLSearchParams({
      ...(p ? { period: p } : {}),
      ...(o ? { owner: o } : {}),
    }).toString()}`;

  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/reports/sales"
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight sm:text-2xl">
              Sales by Rep
            </h1>
            <p className="text-sm text-muted-foreground">
              Billed revenue per salesperson{owner && ownerRep ? ` — ${ownerRep.name}` : ""}
            </p>
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {period ? "Period revenue" : "All-time revenue"}
          </div>
          <div className="text-lg font-semibold sm:text-xl">{KES(totals.revenue)}</div>
          <div className="text-xs text-muted-foreground">
            {totals.invoices} invoice{totals.invoices === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* Filters: period pills + owner */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={qs("", owner)}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            !period ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
          }`}
        >
          All time
        </Link>
        {monthOptions().slice(0, 6).map((m) => (
          <Link
            key={m.value}
            href={qs(m.value, owner)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              period === m.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            {m.label}
          </Link>
        ))}
        {owner && (
          <Link
            href={qs(period, "")}
            className="rounded-full border border-destructive/40 px-3 py-1 text-xs font-medium text-destructive"
          >
            ✕ Clear rep filter
          </Link>
        )}
      </div>

      {/* Leaderboard */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No attributed sales{period ? " in this period" : ""} yet. Invoices
              created from quotes, sales orders or won deals carry their
              salesperson automatically.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {filtered.map((r, i) => (
                <Link
                  key={r.employeeId || "none"}
                  href={r.employeeId ? qs(period, r.employeeId) : "#"}
                  className={`flex items-center gap-3 px-4 py-3 ${
                    r.employeeId ? "hover:bg-accent/40" : "cursor-default"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      i === 0 && !owner
                        ? "bg-yellow-500/15 text-yellow-600"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {i === 0 && !owner ? <Trophy className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.invoices} invoice{r.invoices === 1 ? "" : "s"} ·
                      collected {KESc(r.collected)} · due {KESc(r.outstanding)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-semibold tabular-nums">
                    <span className="sm:hidden">{KESc(r.revenue)}</span>
                    <span className="hidden sm:inline">{KES(r.revenue)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drill-down: the filtered rep's invoices */}
      {owner && (
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            <p className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Invoices — {ownerRep?.name || "rep"}
            </p>
            {drillDown.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No invoices in this period.
              </p>
            ) : (
              <div className="divide-y divide-border/60">
                {drillDown.map((inv) => (
                  <Link
                    key={inv._id}
                    href={`/dashboard/invoices/${inv._id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent/40"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{inv.invoiceNumber}</span>
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {inv.customer}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-sm">
                      <span
                        className={`text-xs capitalize ${
                          inv.paymentStatus === "paid"
                            ? "text-emerald-600"
                            : inv.paymentStatus === "overdue"
                              ? "text-red-600"
                              : "text-muted-foreground"
                        }`}
                      >
                        {inv.paymentStatus}
                      </span>
                      <span className="font-medium tabular-nums">{KESc(inv.total)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LogOut, Plus } from "lucide-react";
import { listExitsForPage } from "@/app/db/actions/hr-exit-actions";
import { can } from "@/lib/capabilities";
import { EXIT_TYPE_LABELS } from "@/lib/hr/final-dues";
import { ExitStatusBadge } from "./components/ExitStatusBadge";

export const metadata = { title: "Exits & Final Dues | HR" };

const canSee = (role) =>
  can(role, "exit.manage") || can(role, "exit.approve") || can(role, "exit.pay");

const kes = (n) =>
  `KES ${(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (d) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—";

async function ExitList({ searchParams }) {
  const params = await searchParams;
  const page = parseInt(params.page || "1");
  const status = params.status || "";
  const search = params.search || "";
  const { exits, pagination } = await listExitsForPage({ page, status, search });

  if (exits.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
        <LogOut className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">
          {status ? `No ${status} exits.` : "No exits yet."}
        </p>
      </div>
    );
  }

  const link = (p) => `?page=${p}&status=${status}&search=${encodeURIComponent(search)}`;

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Exit #</th>
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Last day</th>
              <th className="px-4 py-3">Clearance</th>
              <th className="px-4 py-3 text-right">Net dues</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {exits.map((x) => (
              <tr key={x.id} className="transition-colors hover:bg-muted/50">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{x.exitNumber}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{x.employeeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {x.employeeNumber}
                    {x.department ? ` · ${x.department}` : ""}
                  </p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{EXIT_TYPE_LABELS[x.exitType] ?? x.exitType}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(x.lastWorkingDate)}</td>
                <td className="px-4 py-3 text-xs">
                  {x.status === "draft" ? (
                    x.clearanceOpen > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">{x.clearanceOpen} open</span>
                    ) : (
                      <span className="text-emerald-700 dark:text-emerald-400">Complete</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-foreground">
                  {x.status === "draft" ? <span className="text-muted-foreground">Draft</span> : kes(x.netPay)}
                </td>
                <td className="px-4 py-3"><ExitStatusBadge status={x.status} /></td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/dashboard/hr/exits/${x.id}`} className="text-xs text-primary hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-border md:hidden">
        {exits.map((x) => (
          <Link key={x.id} href={`/dashboard/hr/exits/${x.id}`} className="block p-4 transition-colors hover:bg-muted/50">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{x.employeeName}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{x.exitNumber}</p>
              </div>
              <ExitStatusBadge status={x.status} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {EXIT_TYPE_LABELS[x.exitType] ?? x.exitType} · Last day {formatDate(x.lastWorkingDate)}
              {x.status !== "draft" ? ` · ${kes(x.netPay)}` : ""}
            </p>
          </Link>
        ))}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <p className="text-muted-foreground">{pagination.total} exits</p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={link(page - 1)} className="rounded border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground">
                Previous
              </Link>
            )}
            {page < pagination.totalPages && (
              <Link href={link(page + 1)} className="rounded border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default async function ExitsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSee(session.user.role)) redirect("/dashboard");

  const params = await searchParams;
  const canManage = can(session.user.role, "exit.manage");

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Exits &amp; Final Dues</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Clearance, final dues and the certificate of service for everyone leaving.
          </p>
        </div>
        {canManage && (
          <Link
            href="/dashboard/hr/exits/create"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Start an exit</span>
            <span className="sm:hidden">New</span>
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 shadow-sm">
          {[
            { value: "", label: "All" },
            { value: "draft", label: "In progress" },
            { value: "approved", label: "Awaiting payment" },
            { value: "paid", label: "Settled" },
            { value: "cancelled", label: "Cancelled" },
          ].map((s) => (
            <Link
              key={s.value}
              href={`?status=${s.value}&search=${encodeURIComponent(params.search || "")}`}
              className={`shrink-0 rounded-md px-4 py-1.5 text-sm transition-colors ${
                (params.status || "") === s.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </Link>
          ))}
        </div>
        <form className="w-full sm:w-64">
          <input type="hidden" name="status" value={params.status || ""} />
          <input
            name="search"
            defaultValue={params.search || ""}
            placeholder="Search name or number…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </form>
      </div>

      <Suspense
        fallback={
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        }
      >
        <ExitList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

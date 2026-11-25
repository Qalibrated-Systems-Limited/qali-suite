import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ArrowRight, ChevronDown, Workflow } from "lucide-react";
import { canSeeFinanceNav } from "@/lib/permissions";
import { FINANCE_PROCESSES } from "@/lib/finance/processes";
import { getProcessCounts } from "@/app/db/actions/finance-handoff-actions";

export const metadata = { title: "Finance processes" };
export const dynamic = "force-dynamic";

/**
 * Every money process, in the order its steps happen, with what is waiting
 * at each step right now. A step comes after the one to its left; a number
 * on a step is work waiting there.
 */
export default async function FinanceProcessesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeFinanceNav(session.user.role)) redirect("/dashboard");
  const counts = await getProcessCounts();
  const waiting = (key) => (key ? counts[key] : null);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-1 py-2 sm:px-2">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
          <Workflow className="h-6 w-6 text-primary" /> Finance processes
        </h1>
        <p className="text-sm text-muted-foreground">
          How money moves through QaliSuite, step by step. Each step comes after the one before it; the number is what is
          waiting at that step now. Click a step to work on it.
        </p>
      </div>

      {FINANCE_PROCESSES.map((p) => {
        const total = p.steps.reduce((a, s) => a + (Number(waiting(s.count)) || 0), 0);
        return (
          <section key={p.id} className="rounded-xl border border-border bg-card">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">{p.title}</h2>
                <p className="text-xs text-muted-foreground">{p.blurb}</p>
              </div>
              <span className={`text-xs ${total ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                {total ? `${total} waiting` : "Nothing waiting"}
              </span>
            </header>
            <ol className="flex flex-col gap-1 p-3 md:flex-row md:items-stretch md:gap-0">
              {p.steps.map((s, i) => {
                const n = waiting(s.count);
                const busy = Number(n) > 0;
                return (
                  <li key={s.label} className="flex flex-col items-stretch md:flex-1 md:flex-row md:items-center">
                    <Link
                      href={s.href}
                      className={`group flex flex-1 items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/50 hover:bg-muted/40 ${
                        busy ? "border-amber-500/50 bg-amber-500/5" : "border-border"
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          busy ? "bg-amber-500 text-black" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-tight">{s.label}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {n === null || n === undefined ? s.hint : busy ? `${n} ${s.hint}` : `None — ${s.hint}`}
                        </span>
                      </span>
                    </Link>
                    {i < p.steps.length - 1 && (
                      <>
                        <ArrowRight className="mx-1 hidden h-4 w-4 shrink-0 text-muted-foreground md:block" aria-hidden />
                        <ChevronDown className="mx-auto my-0.5 h-4 w-4 text-muted-foreground md:hidden" aria-hidden />
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

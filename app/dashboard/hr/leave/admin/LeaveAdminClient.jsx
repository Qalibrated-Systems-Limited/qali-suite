"use client";

import { useActionState } from "react";
import { RefreshCw, TrendingUp, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runCarryOver, runAccrual } from "@/app/db/actions/hr-leave-actions";

const initial = { success: false, error: null, message: null };

function Result({ state }) {
  if (state.error) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        {state.error}
      </div>
    );
  }
  if (state.success && state.message) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:text-emerald-400">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        {state.message}
      </div>
    );
  }
  return null;
}

const field =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

export default function LeaveAdminClient({ leaveTypes = [] }) {
  const [carryState, carryAction, carryPending] = useActionState(runCarryOver, initial);
  const [accrualState, accrualAction, accrualPending] = useActionState(runAccrual, initial);

  const thisYear = new Date().getFullYear();
  const thisMonth = new Date().getMonth() + 1;
  const annual = leaveTypes.find((t) => t.code === "annual") ?? leaveTypes[0];

  return (
    <div className="space-y-6">
      <form action={carryAction} className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold text-foreground">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          Carry unused leave into the new year
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each leave type carries over up to its own configured maximum. Last
          year&apos;s record is left exactly as it is — this writes a new row
          for the new year, so running it twice gives the same answer.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">From</label>
            <input name="fromYear" type="number" defaultValue={thisYear} className={field} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Into</label>
            <input name="toYear" type="number" defaultValue={thisYear + 1} className={field} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Leave type
            </label>
            <select name="leaveTypeId" className={field} defaultValue="">
              <option value="">Every type that carries over</option>
              {leaveTypes
                .filter((t) => t.maxCarryOver > 0)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (max {t.maxCarryOver})
                  </option>
                ))}
            </select>
          </div>
        </div>

        <Result state={carryState} />

        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={carryPending}>
            {carryPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Run carry-over
          </Button>
        </div>
      </form>

      <form action={accrualAction} className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold text-foreground">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          Accrue leave month by month
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sets the entitlement to what has been EARNED by the end of the month
          you choose — Kenya&apos;s 21 days is 1.75 a month. Somebody hired in
          April accrues from April. Running it again for the same month changes
          nothing, and running it for a month you missed catches up.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Year</label>
            <input name="year" type="number" defaultValue={thisYear} className={field} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Accrued through
            </label>
            <select name="throughMonth" defaultValue={thisMonth} className={field}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleDateString("en-KE", { month: "long" })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Leave type
            </label>
            <select name="leaveTypeId" defaultValue={annual?.id ?? ""} className={field}>
              {leaveTypes
                .filter((t) => t.affectsBalance)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Days per month
            </label>
            <input
              name="daysPerMonth"
              type="number"
              step="0.25"
              min="0.25"
              defaultValue={1.75}
              className={field}
            />
          </div>
        </div>

        <Result state={accrualState} />

        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={accrualPending}>
            {accrualPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Run accrual
          </Button>
        </div>
      </form>

      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        To pay out unused leave instead of taking it, open the employee&apos;s
        record → Leave balances. The amount is reported back for you to add to
        their next payslip as a one-off earning; encashed days reduce the
        balance without being counted as days taken.
      </div>
    </div>
  );
}

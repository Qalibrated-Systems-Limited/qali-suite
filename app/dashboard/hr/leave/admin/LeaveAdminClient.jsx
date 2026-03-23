"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, TrendingUp, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runLeaveCarryOver, runLeaveAccrual } from "@/app/mongodb/actions/hr-leave-admin-actions";

function ResultBanner({ result }) {
  if (!result) return null;
  if (!result.success) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
        <AlertCircle className="h-4 w-4 shrink-0" /> {result.error}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:text-emerald-400">
      <CheckCircle2 className="h-4 w-4 shrink-0" /> {result.message}
    </div>
  );
}

export default function LeaveAdminClient() {
  const router = useRouter();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Carry-over state
  const [coFromYear, setCoFromYear] = useState(currentYear - 1);
  const [coToYear, setCoToYear] = useState(currentYear);
  const [coMax, setCoMax] = useState(10);
  const [coResult, setCoResult] = useState(null);
  const [coLoading, startCO] = useTransition();

  // Accrual state
  const [accYear, setAccYear] = useState(currentYear);
  const [accMonth, setAccMonth] = useState(currentMonth);
  const [accDays, setAccDays] = useState(1.75);
  const [accResult, setAccResult] = useState(null);
  const [accLoading, startAcc] = useTransition();

  function handleCarryOver() {
    if (!confirm(`Run leave carry-over from ${coFromYear} → ${coToYear}? This will update all active employees.`)) return;
    startCO(async () => {
      const result = await runLeaveCarryOver({ fromYear: coFromYear, toYear: coToYear, maxCarryOver: coMax });
      setCoResult(result);
      if (result.success) { toast.success(result.message); router.refresh(); }
      else toast.error(result.error);
    });
  }

  function handleAccrual() {
    if (!confirm(`Run monthly accrual of ${accDays} days for ${accMonth}/${accYear}?`)) return;
    startAcc(async () => {
      const result = await runLeaveAccrual({ year: accYear, month: accMonth, accrualDays: accDays });
      setAccResult(result);
      if (result.success) { toast.success(result.message); router.refresh(); }
      else toast.error(result.error);
    });
  }

  const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <div className="space-y-6">
      {/* Carry-over */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Year-End Carry-Over
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Roll unused annual leave days into the new year. Runs once per year — usually in December or January.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">From Year</label>
            <input type="number" value={coFromYear} onChange={(e) => setCoFromYear(parseInt(e.target.value))} className={inputClass} min="2020" max="2100" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">To Year</label>
            <input type="number" value={coToYear} onChange={(e) => setCoToYear(parseInt(e.target.value))} className={inputClass} min="2020" max="2100" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Max Carry-Over (days)</label>
            <input type="number" value={coMax} onChange={(e) => setCoMax(parseInt(e.target.value))} className={inputClass} min="0" max="30" />
          </div>
        </div>

        <ResultBanner result={coResult} />

        <Button onClick={handleCarryOver} disabled={coLoading} variant="outline">
          {coLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Run Carry-Over
        </Button>
      </div>

      {/* Monthly Accrual */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> Monthly Leave Accrual
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Credit employees with their monthly leave accrual (e.g. 1.75 days for 21-day annual entitlement).
            Run once per month after payroll.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Year</label>
            <input type="number" value={accYear} onChange={(e) => setAccYear(parseInt(e.target.value))} className={inputClass} min="2020" max="2100" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Month</label>
            <select value={accMonth} onChange={(e) => setAccMonth(parseInt(e.target.value))} className={inputClass}>
              {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Accrual Days</label>
            <input type="number" value={accDays} onChange={(e) => setAccDays(parseFloat(e.target.value))} className={inputClass} step="0.25" min="0" max="10" />
          </div>
        </div>

        <ResultBanner result={accResult} />

        <Button onClick={handleAccrual} disabled={accLoading} variant="outline">
          {accLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
          Run Accrual
        </Button>
      </div>

      {/* Encashment note */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm font-medium text-foreground mb-1">Leave Encashment</p>
        <p className="text-sm text-muted-foreground">
          To encash unused leave for an employee, go to their profile → Leave Balances → Encash.
          The encashment amount is added as an additional earning to their next payroll entry.
        </p>
      </div>
    </div>
  );
}

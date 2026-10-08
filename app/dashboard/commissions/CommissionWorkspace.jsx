"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Trophy,
  Coins,
  CheckCircle2,
  Clock,
  Users,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  recordCommission,
  setCommissionStatusAction,
  deleteCommissionAction,
  saveTierAction,
} from "@/app/db/actions/commission-actions";

const kes = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(
    Math.round(Number(n) || 0),
  );
const monthLabel = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-KE", { month: "short", year: "numeric" })
    : "—";

const TIER_TONE = {
  T4: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  T3: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  T2: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  T1: "bg-muted text-muted-foreground",
};

function Kpi({ icon: Icon, label, value, tone = "" }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </Card>
  );
}

export default function CommissionWorkspace({ data, canManage, month, status }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const formRef = useRef(null);
  const [tier, setTier] = useState("");
  const [revenue, setRevenue] = useState("");

  const { tiers = [], rows = [], leaderboard = [], totals = {}, months = [], people = [] } = data || {};
  const tierByLevel = Object.fromEntries(tiers.map((t) => [t.level, t]));
  const selectedTier = tierByLevel[tier];
  const preview =
    selectedTier && revenue
      ? Number(revenue) * Number(selectedTier.multiplier)
      : 0;

  const setParam = (key, value) => {
    const params = new URLSearchParams();
    if (key === "month" ? value : month) params.set("month", key === "month" ? value : month);
    if (key === "status" ? value : status) params.set("status", key === "status" ? value : status);
    router.push(`/dashboard/commissions${params.toString() ? `?${params}` : ""}`);
  };

  const run = (fn, okMsg) =>
    startTransition(async () => {
      const res = await fn();
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? okMsg ?? "Done.");
        router.refresh();
      }
    });

  const submitCommission = () => {
    const fd = new FormData(formRef.current);
    const t = tierByLevel[fd.get("tierLevel")];
    if (t) fd.set("tierMultiplier", String(t.multiplier));
    run(() => recordCommission(fd), "Commission recorded.");
    formRef.current?.reset();
    setTier("");
    setRevenue("");
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Commissions</h1>
          <p className="text-sm text-muted-foreground">
            Record the revenue each person is credited with; the tier multiplier
            turns it into commission. Top earners are ranked below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setParam("month", e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">All months</option>
            {months.map((m) => (
              <option key={m} value={String(m).slice(0, 7)}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setParam("status", e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">All status</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi icon={Coins} label="Revenue credited" value={`KES ${kes(totals.revenue)}`} />
        <Kpi icon={Trophy} label="Commission" value={`KES ${kes(totals.commission)}`} />
        <Kpi icon={Clock} label="Pending" value={`KES ${kes(totals.pending)}`} tone="text-amber-600 dark:text-amber-400" />
        <Kpi icon={CheckCircle2} label="Paid" value={`KES ${kes(totals.paid)}`} tone="text-emerald-600 dark:text-emerald-400" />
        <Kpi icon={Users} label="People" value={totals.people ?? 0} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Leaderboard */}
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            <h2 className="font-semibold">Top earners</h2>
            <span className="text-xs text-muted-foreground">
              {month ? monthLabel(month + "-01") : "all time"}
            </span>
          </div>
          {leaderboard.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No commissions recorded yet.
            </p>
          ) : (
            <ul className="divide-y">
              {leaderboard.map((e) => (
                <li key={e.employeeId} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                    {e.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.name}</p>
                    <p className="text-xs text-muted-foreground">
                      KES {kes(e.totalRevenue)} revenue · {e.entries} entr{e.entries === 1 ? "y" : "ies"}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TIER_TONE[e.tier] || TIER_TONE.T1}`}>
                    {e.tier}
                  </span>
                  <span className="w-28 text-right text-sm font-semibold tabular-nums text-primary">
                    KES {kes(e.totalCommission)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Tier multipliers */}
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">Tier multipliers</h2>
          <ul className="space-y-1.5">
            {tiers.map((t) => (
              <li key={t.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TIER_TONE[t.level] || TIER_TONE.T1}`}>
                    {t.level}
                  </span>
                  <span className="text-muted-foreground">{t.name}</span>
                </span>
                <span className="font-semibold tabular-nums">{Number(t.multiplier)}×</span>
              </li>
            ))}
          </ul>
          {canManage && <TierEditor tiers={tiers} onSaved={() => run(async () => ({}), "")} pending={pending} />}
        </Card>
      </div>

      {/* Record a commission */}
      {canManage && (
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">Record a commission</h2>
          <form ref={formRef} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-xs">Staff member</Label>
              <select name="employeeId" required className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                <option value="">Choose…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Month</Label>
              <Input type="month" name="periodMonth" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Revenue credited (KES)</Label>
              <Input type="number" name="revenueAmount" min="0" step="any" value={revenue} onChange={(e) => setRevenue(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tier</Label>
              <select name="tierLevel" required value={tier} onChange={(e) => setTier(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                <option value="">Choose…</option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.level}>{t.level} — {Number(t.multiplier)}×</option>
                ))}
              </select>
              <input type="hidden" name="tierMultiplier" value={selectedTier?.multiplier ?? ""} />
            </div>
            <div className="flex flex-col justify-end gap-1.5">
              <Label className="text-xs">Commission</Label>
              <div className="flex h-9 items-center justify-between gap-2">
                <span className="text-sm font-semibold tabular-nums text-primary">KES {kes(preview)}</span>
                <Button type="button" size="sm" onClick={submitCommission} disabled={pending}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {/* Entries */}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Staff</th>
              <th className="p-3 font-medium">Month</th>
              <th className="p-3 text-right font-medium">Revenue</th>
              <th className="p-3 font-medium">Tier</th>
              <th className="p-3 text-right font-medium">Commission</th>
              <th className="p-3 font-medium">Status</th>
              {canManage && <th className="p-3" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 7 : 6} className="p-8 text-center text-muted-foreground">
                  No commissions {month || status ? "for this filter" : "yet"}.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{r.employeeName}</td>
                  <td className="p-3 text-muted-foreground">{monthLabel(r.periodMonth)}</td>
                  <td className="p-3 text-right tabular-nums">{kes(r.revenueAmount)}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TIER_TONE[r.tierLevel] || TIER_TONE.T1}`}>
                      {r.tierLevel} · {Number(r.tierMultiplier)}×
                    </span>
                  </td>
                  <td className="p-3 text-right font-semibold tabular-nums">{kes(r.commissionAmount)}</td>
                  <td className="p-3">
                    <Badge variant={r.status === "paid" ? "default" : "secondary"}>
                      {r.status}
                    </Badge>
                  </td>
                  {canManage && (
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant={r.status === "paid" ? "outline" : "default"}
                          onClick={() => run(() => setCommissionStatusAction(r.id, r.status === "paid" ? "pending" : "paid"))}
                          disabled={pending}
                        >
                          {r.status === "paid" ? "Mark pending" : "Mark paid"}
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => run(() => deleteCommissionAction(r.id), "Deleted.")} disabled={pending}>
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function TierEditor({ tiers, onSaved, pending }) {
  const ref = useRef(null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const save = () => {
    const fd = new FormData(ref.current);
    startTransition(async () => {
      const res = await saveTierAction(fd);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Tier saved.");
        setOpen(false);
        router.refresh();
      }
    });
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setOpen(true)}>
        Edit tiers
      </Button>
    );
  }
  return (
    <form ref={ref} className="mt-3 space-y-2 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Set a tier's multiplier. Use an existing code (T1–T4) to update it, or a new one to add.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Input name="level" placeholder="Tier code e.g. T4" required />
        <Input name="multiplier" type="number" step="0.05" min="0" placeholder="Multiplier e.g. 2.0" required />
      </div>
      <Input name="name" placeholder="Name (optional)" />
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending}>Save tier</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

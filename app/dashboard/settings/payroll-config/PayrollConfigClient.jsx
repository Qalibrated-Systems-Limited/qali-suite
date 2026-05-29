"use client";

import { useState, useEffect, useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, CheckCircle2, ChevronDown, ChevronUp, Loader2, AlertCircle, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createPayrollConfig, activatePayrollConfig, savePayrollGlMapping, backfillStatutoryAccounts } from "@/app/mongodb/actions/hr-settings-actions";

// ─── Kenya default PAYE brackets (annual taxable income, KES) ───
const KENYA_DEFAULT_BRACKETS = [
  { from: 0,         to: 288000,   rate: 10 },
  { from: 288001,    to: 388000,   rate: 25 },
  { from: 388001,    to: 6000000,  rate: 30 },
  { from: 6000001,   to: 9600000,  rate: 32.5 },
  { from: 9600001,   to: null,     rate: 35 },
];

const initial = { success: false, error: null, fieldErrors: null };

function pct(rate) {
  return rate != null ? `${(rate * 100).toFixed(2)}%` : "—";
}
function fmt(n) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-KE").format(n);
}
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

// ─── Bracket row editor ──────────────────────────────────────────
function BracketRow({ idx, bracket, onChange, onRemove, isLast }) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
      <div>
        {idx === 0 && <label className="mb-1 block text-xs text-muted-foreground">From (KES annual)</label>}
        <input
          name={`bracket_from_${idx}`}
          type="number"
          min="0"
          step="1"
          value={bracket.from ?? ""}
          onChange={(e) => onChange(idx, "from", e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          required
        />
      </div>
      <div>
        {idx === 0 && <label className="mb-1 block text-xs text-muted-foreground">To (blank = no limit)</label>}
        <input
          name={`bracket_to_${idx}`}
          type="number"
          min="0"
          step="1"
          value={bracket.to ?? ""}
          onChange={(e) => onChange(idx, "to", e.target.value)}
          placeholder="No limit"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div>
        {idx === 0 && <label className="mb-1 block text-xs text-muted-foreground">Rate (%)</label>}
        <input
          name={`bracket_rate_${idx}`}
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={bracket.rate ?? ""}
          onChange={(e) => onChange(idx, "rate", e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          required
        />
      </div>
      <button
        type="button"
        onClick={() => onRemove(idx)}
        className="mb-0.5 rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
        disabled={isLast}
        title="Remove bracket"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── New Config Form ─────────────────────────────────────────────
function NewConfigForm({ onSuccess }) {
  const [state, formAction, isPending] = useActionState(createPayrollConfig, initial);
  const [brackets, setBrackets] = useState(KENYA_DEFAULT_BRACKETS);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (state.success) {
      toast.success("Payroll configuration saved");
      onSuccess?.();
    }
  }, [state.success]);

  function updateBracket(idx, field, value) {
    setBrackets((prev) => prev.map((b, i) => i === idx ? { ...b, [field]: value === "" ? null : value } : b));
  }
  function addBracket() {
    setBrackets((prev) => [...prev, { from: 0, to: null, rate: 0 }]);
  }
  function removeBracket(idx) {
    setBrackets((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-semibold text-foreground">New Payroll Configuration</span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <form action={formAction} className="border-t border-border px-5 py-5 space-y-6">
          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" /> {state.error}
            </div>
          )}

          {/* Name + Effective From */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Config Name <span className="text-destructive">*</span></label>
              <input
                name="name"
                type="text"
                placeholder="e.g. FY 2024/25 — Finance Act"
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.name ? "border-destructive" : "border-border"}`}
                required
              />
              {state.fieldErrors?.name && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.name}</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Effective From <span className="text-destructive">*</span></label>
              <input
                name="effectiveFrom"
                type="date"
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.effectiveFrom ? "border-destructive" : "border-border"}`}
                required
              />
            </div>
          </div>

          {/* PAYE Brackets */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PAYE Tax Brackets (Annual taxable income)</p>
              <button type="button" onClick={addBracket} className="flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus className="h-3 w-3" /> Add bracket
              </button>
            </div>
            <div className="space-y-2">
              {brackets.map((b, i) => (
                <BracketRow
                  key={i}
                  idx={i}
                  bracket={b}
                  onChange={updateBracket}
                  onRemove={removeBracket}
                  isLast={brackets.length === 1}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Rates in % (e.g. 10 = 10%). Last bracket should have no upper limit.</p>
          </div>

          {/* Personal Relief */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">PAYE Relief</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Personal Relief (KES/month)</label>
                <input name="personalRelief" type="number" min="0" step="1" defaultValue="2400"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required />
              </div>
            </div>
          </div>

          {/* NSSF */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">NSSF (National Social Security Fund)</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Tier I LEL (KES basic)</label>
                <input name="nssfTierILimit" type="number" min="0" step="1" defaultValue="6000"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Tier II UEL (KES basic)</label>
                <input name="nssfTierIILimit" type="number" min="0" step="1" defaultValue="18000"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Employee Rate (%)</label>
                <input name="nssfEmployeeRate" type="number" min="0" max="100" step="0.01" defaultValue="6"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Employer Rate (%)</label>
                <input name="nssfEmployerRate" type="number" min="0" max="100" step="0.01" defaultValue="6"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required />
              </div>
            </div>
          </div>

          {/* SHIF */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">SHIF (Social Health Insurance Fund)</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">SHIF Rate (% of gross)</label>
                <input name="shifRate" type="number" min="0" max="100" step="0.01" defaultValue="2.75"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required />
                <p className="mt-1 text-xs text-muted-foreground">Replaced NHIF from October 2024. Flat % — no cap.</p>
              </div>
            </div>
          </div>

          {/* AHL */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AHL (Affordable Housing Levy)</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Employee Rate (% of gross)</label>
                <input name="ahlEmployeeRate" type="number" min="0" max="100" step="0.01" defaultValue="1.5"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Employer Rate (% of gross)</label>
                <input name="ahlEmployerRate" type="number" min="0" max="100" step="0.01" defaultValue="1.5"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required />
                <p className="mt-1 text-xs text-muted-foreground">Mandatory from March 2024.</p>
              </div>
            </div>
          </div>

          {/* Notes + Set Active */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Notes</label>
              <textarea name="notes" rows={2} placeholder="e.g. Finance Act 2024 changes..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 hover:bg-muted/50">
                <input type="checkbox" name="setActive" defaultChecked className="h-4 w-4 accent-primary" />
                <span className="text-sm font-medium text-foreground">Set as active config</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Configuration
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── GL Mapping Form ─────────────────────────────────────────────
const GL_FIELDS = [
  { key: "salaryExpense",       label: "Salary Expense",              side: "Dr", hint: "Expense — debited on approve" },
  { key: "employerNssfExpense", label: "Employer NSSF Expense",       side: "Dr", hint: "Expense — debited on approve" },
  { key: "employerAhlExpense",  label: "Employer AHL Expense",        side: "Dr", hint: "Expense — debited on approve" },
  { key: "salaryPayable",       label: "Net Salaries Payable",        side: "Cr", hint: "Liability — cleared on payment" },
  { key: "payePayable",         label: "PAYE Payable (KRA)",          side: "Cr", hint: "Liability — remit to KRA" },
  { key: "nssfPayable",         label: "NSSF Payable",                side: "Cr", hint: "Liability — remit to NSSF" },
  { key: "shifPayable",         label: "SHIF Payable",                side: "Cr", hint: "Liability — remit to SHA" },
  { key: "ahlPayable",          label: "AHL Payable",                 side: "Cr", hint: "Liability — remit to Housing Fund" },
  { key: "bankAccount",         label: "Bank Account (payment)",      side: "Cr", hint: "Asset — credited when salaries are paid" },
];

function GlMappingForm({ config, accounts }) {
  const [state, formAction, isPending] = useActionState(savePayrollGlMapping, { success: false, error: null });
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [isBackfilling, startBackfill] = useTransition();

  useEffect(() => {
    if (state.success) toast.success("GL mapping saved");
  }, [state.success]);

  const glMapping = config.glMapping || {};

  function handleBackfill() {
    startBackfill(async () => {
      const res = await backfillStatutoryAccounts();
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error || "Could not backfill statutory accounts");
      }
    });
  }

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">GL Account Mapping</span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <form action={formAction} className="px-4 pb-4 space-y-4">
          <input type="hidden" name="configId" value={config._id} />
          <p className="text-xs text-muted-foreground">
            Map payroll line items to GL accounts. When payroll is approved, the accrual journal is posted automatically.
            When marked paid, the clearing journal is posted. All fields are optional — posting is skipped if an account is not mapped.
          </p>

          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="flex-1 text-xs">
              <p className="font-medium text-foreground">Missing accounts?</p>
              <p className="text-muted-foreground">
                Older tenants may be missing AHL Payable, Salaries Payable, or Employer AHL. Run backfill to add them — safe to click repeatedly.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleBackfill}
              disabled={isBackfilling}
            >
              {isBackfilling && <Loader2 className="h-3 w-3 animate-spin" />}
              {isBackfilling ? "Backfilling..." : "Backfill statutory accounts"}
            </Button>
          </div>

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {state.error}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {GL_FIELDS.map(({ key, label, side, hint }) => (
              <div key={key}>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <span className={`rounded px-1 py-0.5 font-mono text-[10px] font-semibold ${side === "Dr" ? "bg-blue-500/10 text-blue-700 dark:text-blue-400" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"}`}>{side}</span>
                  {label}
                </label>
                <select
                  name={key}
                  defaultValue={glMapping[key]?.toString() || ""}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">— Not mapped —</option>
                  {accounts.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.accountCode} · {a.accountName}
                    </option>
                  ))}
                </select>
                <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Save GL Mapping
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Config Card (existing config) ──────────────────────────────
function ConfigCard({ config, onActivate, canEdit, accounts }) {
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleActivate() {
    startTransition(async () => {
      const result = await activatePayrollConfig(config._id);
      if (result?.success === false) toast.error(result.error);
      else toast.success("Configuration set as active");
      onActivate?.();
    });
  }

  return (
    <div className={`rounded-lg border bg-card shadow-sm ${config.isActive ? "border-emerald-500/40" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3 px-4 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-foreground">{config.name}</p>
            {config.isActive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="h-3 w-3" /> Active
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Effective from {fmtDate(config.effectiveFrom)}
            {config.effectiveTo ? ` to ${fmtDate(config.effectiveTo)}` : ""}
          </p>
          {config.notes && <p className="mt-1 text-xs text-muted-foreground">{config.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!config.isActive && (
            <Button size="sm" variant="outline" onClick={handleActivate} disabled={isPending}>
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Set Active
            </Button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-4 text-sm">
          {/* PAYE Brackets */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">PAYE Brackets (Annual)</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-1 text-left">From (KES)</th>
                  <th className="py-1 text-left">To (KES)</th>
                  <th className="py-1 text-right">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {config.payeBrackets.map((b, i) => (
                  <tr key={i}>
                    <td className="py-1 font-mono">{fmt(b.from)}</td>
                    <td className="py-1 font-mono">{b.to != null ? fmt(b.to) : "No limit"}</td>
                    <td className="py-1 text-right font-mono">{pct(b.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Other rates */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">PAYE Relief</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Personal Relief</span><span className="font-mono">KES {fmt(config.personalRelief)}/month</span></div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">NSSF</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Tier I LEL</span><span className="font-mono">KES {fmt(config.nssfTierILimit)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tier II UEL</span><span className="font-mono">KES {fmt(config.nssfTierIILimit)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Employee rate</span><span className="font-mono">{pct(config.nssfEmployeeRate)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Employer rate</span><span className="font-mono">{pct(config.nssfEmployerRate)}</span></div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">SHIF</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Rate (of gross)</span><span className="font-mono">{pct(config.shifRate)}</span></div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AHL</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Employee rate</span><span className="font-mono">{pct(config.ahlEmployeeRate)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Employer rate</span><span className="font-mono">{pct(config.ahlEmployerRate)}</span></div>
              </div>
            </div>
          </div>

          {/* GL Mapping — Admin only */}
          {canEdit && accounts?.length > 0 && (
            <GlMappingForm config={config} accounts={accounts} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────
export default function PayrollConfigClient({ initialConfigs, canEdit, accounts = [] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(initialConfigs.length === 0 && canEdit);

  function handleMutation() {
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Existing configs */}
      {initialConfigs.length > 0 ? (
        <div className="space-y-3">
          {initialConfigs.map((c) => (
            <ConfigCard key={c._id} config={c} onActivate={canEdit ? handleMutation : null} canEdit={canEdit} accounts={accounts} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-5 text-sm text-amber-700 dark:border-amber-900 dark:text-amber-400">
          <p className="font-semibold">No payroll configuration found</p>
          <p className="mt-1">Payroll cannot be generated until a configuration with statutory rates is created.</p>
        </div>
      )}

      {/* Toggle form — Admin only */}
      {canEdit && !showForm && (
        <Button variant="outline" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" /> New Configuration
        </Button>
      )}

      {canEdit && showForm && (
        <NewConfigForm onSuccess={handleMutation} />
      )}
    </div>
  );
}

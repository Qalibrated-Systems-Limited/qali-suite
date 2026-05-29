"use client";

import { useActionState, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createKpi, updateKpi } from "@/app/mongodb/actions/kpi-actions";
import { KpiCombobox } from "./KpiCombobox";

// ============================================
// KPI FORM
// ============================================
// Shared by create + edit. Mode switches the action + label + redirect.
// Owner picker is HR-aware: shows an employee dropdown only when ownerCandidates
// is non-empty; otherwise falls back to free-text name entry. partyId is
// snapshot-extracted server-side.
// ============================================

const CATEGORIES = [
  { value: "financial", label: "Financial" },
  { value: "operational", label: "Operational" },
  { value: "hr", label: "HR / People" },
  { value: "customer", label: "Customer" },
  { value: "compliance", label: "Compliance" },
];

// Combobox-shaped: `group` buckets into headed sections; `description` shows
// under each label in the dropdown; `hint` (if set) shows below the trigger.
const SOURCE_ITEMS = [
  {
    value: "manual",
    label: "Manual entry",
    description: "You record the actual value each period",
    group: "Manual",
  },
  {
    value: "monthly_revenue",
    label: "Revenue",
    description: "Sum of posted revenue journal entries in the period",
    group: "Auto-computed",
  },
  {
    value: "monthly_payroll_cost",
    label: "Payroll Cost",
    description: "Gross pay + employer contributions for runs paid in the period",
    group: "Auto-computed",
  },
  {
    value: "ar_days_outstanding",
    label: "AR Days Outstanding",
    description: "AR balance × days in period ÷ revenue in period",
    group: "Auto-computed",
  },
  {
    value: "cash_position",
    label: "Cash Position",
    description: "Balance of cash + bank + M-Pesa accounts at period end",
    group: "Auto-computed",
  },
  {
    value: "active_headcount",
    label: "Active Headcount",
    description: "Employees with active or probation status",
    group: "Auto-computed",
  },
  {
    value: "gross_margin_percent",
    label: "Gross Margin %",
    description: "(Revenue − COGS) ÷ Revenue × 100",
    group: "Auto-computed",
  },
  {
    value: "opex_ratio",
    label: "Operating Expense Ratio",
    description: "Non-COGS expenses ÷ revenue × 100",
    group: "Auto-computed",
  },
  {
    value: "payroll_to_revenue_ratio",
    label: "Payroll as % of Revenue",
    description: "Payroll cost (gross + employer) ÷ revenue × 100",
    group: "Auto-computed",
  },
  {
    value: "avg_order_value",
    label: "Average Order Value",
    description: "Revenue ÷ count of completed invoices in the period",
    group: "Auto-computed",
  },
];

const UNITS = [
  { value: "currency", label: "Currency (KES)" },
  { value: "percentage", label: "Percentage" },
  { value: "days", label: "Days" },
  { value: "count", label: "Count" },
  { value: "ratio", label: "Ratio" },
];

const PERIODICITIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const DIRECTIONS = [
  { value: "higher_is_better", label: "Higher is better (e.g. revenue, headcount)" },
  { value: "lower_is_better", label: "Lower is better (e.g. AR days, costs)" },
];

export default function KpiForm({ mode = "create", kpi = null, ownerCandidates = [] }) {
  const router = useRouter();

  const action = mode === "create" ? createKpi : updateKpi.bind(null, kpi?._id);
  const [state, formAction, isPending] = useActionState(action, { success: false, error: null });

  // Owner selection: track partyId + name together
  const [ownerMode, setOwnerMode] = useState(() => {
    if (kpi?.owner?.partyId) return "employee";
    if (kpi?.owner?.name) return "freetext";
    return ownerCandidates.length > 0 ? "employee" : "freetext";
  });
  const [selectedPartyId, setSelectedPartyId] = useState(kpi?.owner?.partyId || "");
  const [freetextName, setFreetextName] = useState(kpi?.owner?.name || "");

  // Controlled source so the combobox can drive form state cleanly.
  const [selectedSource, setSelectedSource] = useState(kpi?.source || "manual");
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(
      kpi?.customThresholds?.onTargetThreshold ||
        kpi?.customThresholds?.nearTargetThreshold ||
        kpi?.statusLabels?.onTarget ||
        kpi?.statusLabels?.nearTarget ||
        kpi?.statusLabels?.offTarget
    )
  );

  const customOnTargetPct = kpi?.customThresholds?.onTargetThreshold != null
    ? (kpi.customThresholds.onTargetThreshold * 100).toString()
    : "";
  const customNearTargetPct = kpi?.customThresholds?.nearTargetThreshold != null
    ? (kpi.customThresholds.nearTargetThreshold * 100).toString()
    : "";

  // Shape employee candidates for the combobox. Department becomes the group
  // heading so the picker is naturally bucketed (Finance, Operations, …);
  // employee number folded into the description so search hits on it too.
  const ownerComboItems = useMemo(() => {
    return ownerCandidates
      .filter((c) => c.partyId) // skip employees without a Party link — can't be set as owner
      .map((c) => ({
        value: c.partyId,
        label: c.name,
        description: [c.employeeNumber, c.designation].filter(Boolean).join(" · ") || undefined,
        group: c.department || "Other",
      }));
  }, [ownerCandidates]);

  // No useEffect / toast — createKpi and updateKpi server-actions call
  // `redirect()` on success, so a successful submit navigates away rather
  // than firing client-side notifications. Errors render inline below.
  const fieldErrors = state.fieldErrors || {};

  return (
    <form action={formAction} className="space-y-4">
      <Card className="bg-card border-border">
        <CardContent className="space-y-4 p-4 sm:p-6">
          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" /> {state.error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" name="name" defaultValue={kpi?.name} error={fieldErrors.name} required maxLength={80} />
            <SelectField label="Category" name="category" options={CATEGORIES} defaultValue={kpi?.category || "financial"} error={fieldErrors.category} required />
          </div>

          <TextareaField label="Description" name="description" defaultValue={kpi?.description} placeholder="What does this metric measure, and why does it matter?" />

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Source</label>
              <KpiCombobox
                name="source"
                value={selectedSource}
                onChange={setSelectedSource}
                items={SOURCE_ITEMS}
                placeholder="Choose a source…"
                searchPlaceholder="Search sources…"
                emptyText="No matching sources."
                required
              />
              {fieldErrors.source && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.source}</p>
              )}
            </div>
            <SelectField label="Unit" name="unit" options={UNITS} defaultValue={kpi?.unit || "currency"} error={fieldErrors.unit} required />
            <SelectField label="Periodicity" name="periodicity" options={PERIODICITIES} defaultValue={kpi?.periodicity || "monthly"} error={fieldErrors.periodicity} required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Target" name="target" type="number" step="any" defaultValue={kpi?.target ?? ""} error={fieldErrors.target} required hint="Numeric target per period (e.g. 5000000 for KES 5M)" />
            <SelectField label="Direction" name="targetDirection" options={DIRECTIONS} defaultValue={kpi?.targetDirection || "higher_is_better"} error={fieldErrors.targetDirection} required />
          </div>

          {/* Advanced — custom thresholds + status labels */}
          <div className="border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? "▾" : "▸"} Advanced — custom thresholds & status labels
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-4 rounded-md border border-border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">
                  Override the default 95% / 80% (higher-is-better) or 100% / 120% (lower-is-better) status bands.
                  Leave blank to use defaults.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="On-target threshold (%)"
                    name="onTargetThreshold"
                    type="number"
                    step="0.1"
                    defaultValue={customOnTargetPct}
                    placeholder="e.g. 95"
                    error={fieldErrors.onTargetThreshold}
                  />
                  <Field
                    label="Near-target threshold (%)"
                    name="nearTargetThreshold"
                    type="number"
                    step="0.1"
                    defaultValue={customNearTargetPct}
                    placeholder="e.g. 80"
                    error={fieldErrors.nearTargetThreshold}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field
                    label="On-target label"
                    name="statusLabelOnTarget"
                    defaultValue={kpi?.statusLabels?.onTarget || ""}
                    placeholder="On track"
                  />
                  <Field
                    label="Near-target label"
                    name="statusLabelNearTarget"
                    defaultValue={kpi?.statusLabels?.nearTarget || ""}
                    placeholder="At risk"
                  />
                  <Field
                    label="Off-target label"
                    name="statusLabelOffTarget"
                    defaultValue={kpi?.statusLabels?.offTarget || ""}
                    placeholder="Behind"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Owner */}
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground">Owner</p>
            <p className="text-xs text-muted-foreground">The person accountable for moving this number.</p>

            {ownerCandidates.length > 0 && (
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="_ownerMode"
                    value="employee"
                    checked={ownerMode === "employee"}
                    onChange={() => setOwnerMode("employee")}
                    className="accent-primary"
                  />
                  Employee
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="_ownerMode"
                    value="freetext"
                    checked={ownerMode === "freetext"}
                    onChange={() => setOwnerMode("freetext")}
                    className="accent-primary"
                  />
                  Free text
                </label>
              </div>
            )}

            {ownerMode === "employee" && ownerCandidates.length > 0 ? (
              <KpiCombobox
                name="ownerPartyId"
                value={selectedPartyId}
                onChange={setSelectedPartyId}
                items={ownerComboItems}
                placeholder="Select an employee…"
                searchPlaceholder="Search by name, number, or department…"
                emptyText="No employees match."
              />
            ) : (
              <input
                type="text"
                name="ownerName"
                value={freetextName}
                onChange={(e) => setFreetextName(e.target.value)}
                placeholder="e.g. Sales Team Lead"
                maxLength={80}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "create" ? "Create KPI" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

// ─── Lightweight field components ─────────────────────────────

function Field({ label, name, error, hint, ...rest }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground">{label}</label>
      <input
        name={name}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        {...rest}
      />
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function TextareaField({ label, name, error, ...rest }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground">{label}</label>
      <textarea
        name={name}
        rows={2}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        {...rest}
      />
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function SelectField({ label, name, options, defaultValue, error, hint, required }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground">{label}</label>
      <select
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

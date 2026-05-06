"use client";

import { useActionState, useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";
import { createAsset } from "@/app/mongodb/actions/asset-actions";

// Industry-standard PPE categories (IFRS / IAS 16 alignment).
// Order: long-life tangibles → movable → short-life consumables.
const CATEGORIES = [
  { value: "land", label: "Land" },
  { value: "building", label: "Building" },
  { value: "leasehold_improvement", label: "Leasehold Improvement" },
  { value: "vehicle", label: "Vehicle" },
  { value: "machinery", label: "Plant & Machinery" },
  { value: "office_equipment", label: "Office Equipment" },
  { value: "computer", label: "Computer Equipment" },
  { value: "furniture", label: "Furniture & Fittings" },
  { value: "equipment", label: "Tools & Equipment" },
  { value: "other", label: "Other" },
];

const DEPRECIATION_METHODS = [
  { value: "straight_line", label: "Straight Line" },
  { value: "reducing_balance", label: "Reducing Balance" },
  { value: "none", label: "None (No Depreciation)" },
];

const KRA_CLASSES = [
  { value: "none", label: "None", hint: "" },
  {
    value: "class_I",
    label: "Class I — 37.5%",
    hint: "Heavy machinery, plant",
  },
  {
    value: "class_II",
    label: "Class II — 30%",
    hint: "Computers, office equipment, copiers",
  },
  {
    value: "class_III",
    label: "Class III — 25%",
    hint: "Commercial vehicles, light machinery",
  },
  {
    value: "class_IV",
    label: "Class IV — 12.5%",
    hint: "Furniture, fittings, tools, leasehold improvements",
  },
];

const initialState = {
  success: false,
  error: null,
  fieldErrors: null,
  assetId: null,
};

function formatCurrency(amount) {
  return (amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 0 });
}

function computeStraightLinePreview(cost, salvage, months, startDate, count = 12) {
  if (!cost || !months || cost <= 0 || months < 1) return [];
  const depreciable = Math.max(0, cost - (salvage || 0));
  const monthlyDep = Math.round(depreciable / months);
  const schedule = [];
  let accumulated = 0;
  let remaining = cost;

  const start = startDate ? new Date(startDate) : new Date();
  let month = start.getUTCMonth() + 1;
  let year = start.getUTCFullYear();

  const limit = Math.min(months, count);
  for (let i = 0; i < limit; i++) {
    const thisMonth = monthlyDep;
    accumulated += thisMonth;
    remaining = Math.max(salvage || 0, cost - accumulated);
    schedule.push({
      period: `${year}-${String(month).padStart(2, "0")}`,
      month,
      year,
      dep: thisMonth,
      accumulated,
      bookValue: remaining,
    });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return schedule;
}

function computeReducingBalancePreview(cost, salvage, months, rate, startDate, count = 12) {
  if (!cost || !months || !rate || cost <= 0 || rate <= 0) return [];
  const monthlyRate = rate / 12;
  let remaining = cost;
  let accumulated = 0;
  const schedule = [];

  const start = startDate ? new Date(startDate) : new Date();
  let month = start.getUTCMonth() + 1;
  let year = start.getUTCFullYear();

  const limit = Math.min(months, count);
  for (let i = 0; i < limit; i++) {
    let depAmount = Math.round(remaining * monthlyRate);
    if (remaining - depAmount < (salvage || 0)) {
      depAmount = Math.max(0, remaining - (salvage || 0));
    }
    if (depAmount <= 0) break;
    accumulated += depAmount;
    remaining -= depAmount;
    schedule.push({
      period: `${year}-${String(month).padStart(2, "0")}`,
      month,
      year,
      dep: depAmount,
      accumulated,
      bookValue: remaining,
    });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return schedule;
}

export default function AssetForm({
  accountsByType = {},
  initialValues = null,
  capitalizationSource = null,
  capitalizationThreshold = 0,
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createAsset, initialState);

  const today = new Date().toISOString().slice(0, 10);
  const initialDate = initialValues?.acquisitionDate
    ? initialValues.acquisitionDate.slice(0, 10)
    : today;

  const [category, setCategory] = useState("equipment");
  const [acquisitionCost, setAcquisitionCost] = useState(
    initialValues?.acquisitionCost
      ? String(initialValues.acquisitionCost)
      : ""
  );
  const [acquisitionDate, setAcquisitionDate] = useState(initialDate);
  const [depreciationMethod, setDepreciationMethod] = useState("straight_line");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("60");
  const [salvageValue, setSalvageValue] = useState("0");
  const [depreciationRate, setDepreciationRate] = useState("0");
  const [depreciationStartDate, setDepreciationStartDate] = useState(initialDate);
  const [glOpen, setGlOpen] = useState(false);

  // Sync deprecation start date with acquisition date by default
  useEffect(() => {
    setDepreciationStartDate(acquisitionDate);
  }, [acquisitionDate]);

  useEffect(() => {
    if (category === "land") {
      setDepreciationMethod("none");
    }
  }, [category]);

  // Redirect on success
  useEffect(() => {
    if (state.success && state.assetId) {
      router.push(`/dashboard/assets/${state.assetId}`);
    }
  }, [state.success, state.assetId, router]);

  const preview = useMemo(() => {
    const cost = parseFloat(acquisitionCost) || 0;
    const salvage = parseFloat(salvageValue) || 0;
    const months = parseInt(usefulLifeMonths, 10) || 0;
    const rate = parseFloat(depreciationRate) || 0;
    if (depreciationMethod === "none") return [];
    if (depreciationMethod === "straight_line") {
      return computeStraightLinePreview(cost, salvage, months, depreciationStartDate);
    }
    if (depreciationMethod === "reducing_balance") {
      return computeReducingBalancePreview(
        cost,
        salvage,
        months,
        rate,
        depreciationStartDate
      );
    }
    return [];
  }, [
    acquisitionCost,
    salvageValue,
    usefulLifeMonths,
    depreciationRate,
    depreciationMethod,
    depreciationStartDate,
  ]);

  const fixedAssetAccounts = accountsByType.fixed_asset || [];
  const accumDepAccounts = accountsByType.accumulated_depreciation || [];
  const depExpenseAccounts = accountsByType.depreciation_expense || [];

  return (
    <form action={formAction} className="space-y-6">
      {/* Hidden source-tracking fields (populated when capitalizing from a bill) */}
      {initialValues?.sourceType && (
        <input
          type="hidden"
          name="sourceType"
          value={initialValues.sourceType}
        />
      )}
      {initialValues?.sourceId && (
        <input type="hidden" name="sourceId" value={initialValues.sourceId} />
      )}
      {initialValues?.sourceReference && (
        <input
          type="hidden"
          name="sourceReference"
          value={initialValues.sourceReference}
        />
      )}
      {initialValues?.billLineId && (
        <input
          type="hidden"
          name="billLineId"
          value={initialValues.billLineId}
        />
      )}

      {capitalizationSource && (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-500/5 p-3 text-sm text-blue-800 dark:border-blue-900 dark:text-blue-300">
          <FileText className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">
              Capitalizing from Bill {capitalizationSource.billNumber}
            </p>
            <p className="mt-0.5 text-xs text-blue-700/80 dark:text-blue-400/80">
              Pre-filled from the bill line: &ldquo;
              {capitalizationSource.lineDescription}&rdquo;. Cost shown excludes
              VAT (recoverable separately). Choose the category, useful life,
              and GL accounts below.
            </p>
          </div>
        </div>
      )}

      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-500/5 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      {/* Section 1 — Basic Info */}
      <div className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">Basic Information</h2>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Name <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            name="name"
            required
            maxLength={200}
            defaultValue={initialValues?.name || ""}
            placeholder="e.g. Toyota Hilux Pickup"
            className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
              state.fieldErrors?.name ? "border-destructive" : "border-border"
            }`}
          />
          {state.fieldErrors?.name && (
            <p className="mt-1 text-xs text-destructive">{state.fieldErrors.name}</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Category <span className="text-destructive">*</span>
            </label>
            <select
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
                state.fieldErrors?.category ? "border-destructive" : "border-border"
              }`}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {state.fieldErrors?.category && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.category}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Serial Number
            </label>
            <input
              type="text"
              name="serialNumber"
              maxLength={200}
              placeholder="Optional"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Description
          </label>
          <textarea
            name="description"
            rows={2}
            maxLength={1000}
            defaultValue={initialValues?.description || ""}
            placeholder="Brief description of the asset..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Model</label>
            <input
              type="text"
              name="model"
              maxLength={200}
              placeholder="e.g. Hilux 2024"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Manufacturer
            </label>
            <input
              type="text"
              name="manufacturer"
              maxLength={200}
              placeholder="e.g. Toyota"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {category === "vehicle" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Registration Number
            </label>
            <input
              type="text"
              name="registrationNumber"
              maxLength={50}
              placeholder="e.g. KCB 123X"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}
      </div>

      {/* Section 2 — Acquisition */}
      <div className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">Acquisition</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Acquisition Date <span className="text-destructive">*</span>
            </label>
            <input
              type="date"
              name="acquisitionDate"
              required
              value={acquisitionDate}
              onChange={(e) => setAcquisitionDate(e.target.value)}
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
                state.fieldErrors?.acquisitionDate
                  ? "border-destructive"
                  : "border-border"
              }`}
            />
            {state.fieldErrors?.acquisitionDate && (
              <p className="mt-1 text-xs text-destructive">
                {state.fieldErrors.acquisitionDate}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Acquisition Cost (KES) <span className="text-destructive">*</span>
            </label>
            <input
              type="number"
              name="acquisitionCost"
              required
              min="0"
              step="1"
              value={acquisitionCost}
              onChange={(e) => setAcquisitionCost(e.target.value)}
              placeholder="e.g. 1500000"
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
                state.fieldErrors?.acquisitionCost
                  ? "border-destructive"
                  : "border-border"
              }`}
            />
            {acquisitionCost && parseFloat(acquisitionCost) > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                KES {formatCurrency(parseFloat(acquisitionCost))}
              </p>
            )}
            {capitalizationThreshold > 0 &&
              acquisitionCost &&
              parseFloat(acquisitionCost) > 0 &&
              parseFloat(acquisitionCost) < capitalizationThreshold && (
                <p className="mt-1 rounded-md border border-amber-200 bg-amber-500/5 px-2 py-1 text-xs text-amber-800 dark:border-amber-900 dark:text-amber-300">
                  Below capitalization threshold of KES{" "}
                  {formatCurrency(capitalizationThreshold)}. Consider expensing
                  this as &ldquo;Office Supplies&rdquo; or similar instead of
                  registering as a fixed asset.
                </p>
              )}
            {state.fieldErrors?.acquisitionCost && (
              <p className="mt-1 text-xs text-destructive">
                {state.fieldErrors.acquisitionCost}
              </p>
            )}
          </div>
        </div>

        <input type="hidden" name="currency" value="KES" />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Location
            </label>
            <input
              type="text"
              name="location"
              maxLength={200}
              placeholder="e.g. Head Office"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Department
            </label>
            <input
              type="text"
              name="department"
              maxLength={100}
              placeholder="e.g. Operations"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Notes</label>
          <textarea
            name="notes"
            rows={2}
            maxLength={1000}
            placeholder="Additional notes..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Section 3 — Depreciation */}
      <div className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">Depreciation</h2>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Depreciation Method
          </label>
          <select
            name="depreciationMethod"
            value={depreciationMethod}
            onChange={(e) => setDepreciationMethod(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {DEPRECIATION_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {category === "land" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Land is not depreciated.
            </p>
          )}
        </div>

        {depreciationMethod !== "none" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Useful Life (months)
                </label>
                <input
                  type="number"
                  name="usefulLifeMonths"
                  min="1"
                  max="1200"
                  step="1"
                  value={usefulLifeMonths}
                  onChange={(e) => setUsefulLifeMonths(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {parseInt(usefulLifeMonths, 10) > 0
                    ? `Approx ${(parseInt(usefulLifeMonths, 10) / 12).toFixed(1)} years`
                    : ""}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Salvage Value (KES)
                </label>
                <input
                  type="number"
                  name="salvageValue"
                  min="0"
                  step="1"
                  value={salvageValue}
                  onChange={(e) => setSalvageValue(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            {depreciationMethod === "reducing_balance" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Depreciation Rate (annual, 0-1 decimal)
                </label>
                <input
                  type="number"
                  name="depreciationRate"
                  min="0"
                  max="1"
                  step="0.01"
                  value={depreciationRate}
                  onChange={(e) => setDepreciationRate(e.target.value)}
                  placeholder="e.g. 0.25 for 25%"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Enter as decimal (0.25 = 25% per year)
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Depreciation Start Date
                </label>
                <input
                  type="date"
                  name="depreciationStartDate"
                  value={depreciationStartDate}
                  onChange={(e) => setDepreciationStartDate(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Defaults to acquisition date
                </p>
              </div>

              {depreciationMethod === "straight_line" && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    First-Period Convention
                  </label>
                  <select
                    name="depreciationConvention"
                    defaultValue="full_month"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="full_month">
                      Full month (charge full month from start)
                    </option>
                    <option value="pro_rata">
                      Pro-rata (charge by days in start month)
                    </option>
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pro-rata is IFRS-preferred for material assets bought
                    mid-month.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {depreciationMethod === "none" && (
          <>
            <input type="hidden" name="usefulLifeMonths" value="0" />
            <input type="hidden" name="salvageValue" value={salvageValue || "0"} />
            <input type="hidden" name="depreciationRate" value="0" />
            <input
              type="hidden"
              name="depreciationStartDate"
              value={depreciationStartDate}
            />
          </>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            KRA Wear & Tear Class
          </label>
          <select
            name="kraClass"
            defaultValue="none"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {KRA_CLASSES.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
                {k.hint ? ` (${k.hint})` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Used for Kenya Revenue Authority wear & tear allowance calculations
          </p>
        </div>
      </div>

      {/* Section 4 — Live Depreciation Preview */}
      {depreciationMethod !== "none" && preview.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">
            Depreciation Preview
          </h2>
          <p className="text-xs text-muted-foreground">
            Showing first {preview.length} of {usefulLifeMonths} months
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Month</th>
                  <th className="px-3 py-2 text-right">Dep Amount</th>
                  <th className="px-3 py-2 text-right">Accumulated</th>
                  <th className="px-3 py-2 text-right">Book Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {row.period}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(row.dep)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatCurrency(row.accumulated)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatCurrency(row.bookValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section 5 — GL Accounts (collapsed) */}
      <div className="rounded-lg border border-border bg-card shadow-sm">
        <button
          type="button"
          onClick={() => setGlOpen(!glOpen)}
          className="flex w-full items-center justify-between p-5 text-left"
        >
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              GL Account Mappings (optional)
            </h2>
            <p className="text-xs text-muted-foreground">
              Leave blank to use company defaults
            </p>
          </div>
          {glOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {glOpen && (
          <div className="space-y-4 border-t border-border p-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Fixed Asset Account
              </label>
              <select
                name="assetAccountId"
                defaultValue=""
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— Use company default —</option>
                {fixedAssetAccounts.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.accountCode} — {a.accountName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Accumulated Depreciation Account
              </label>
              <select
                name="accumulatedDepreciationAccountId"
                defaultValue=""
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— Use company default —</option>
                {accumDepAccounts.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.accountCode} — {a.accountName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Depreciation Expense Account
              </label>
              <select
                name="depreciationExpenseAccountId"
                defaultValue=""
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— Use company default —</option>
                {depExpenseAccounts.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.accountCode} — {a.accountName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Link
          href="/dashboard/assets"
          className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Creating..." : "Create Asset"}
        </button>
      </div>
    </form>
  );
}

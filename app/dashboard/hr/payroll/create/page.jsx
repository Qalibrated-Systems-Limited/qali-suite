"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, AlertCircle } from "lucide-react";
import { createPayrollRun } from "@/app/mongodb/actions/hr-payroll-actions";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const initialState = { success: false, error: null, fieldErrors: null };

export default function CreatePayrollRunPage() {
  const [state, formAction, isPending] = useActionState(createPayrollRun, initialState);

  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div className="mx-auto max-w-xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/payroll" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Payroll
        </Link>
        <span>/</span>
        <span className="text-foreground">New Run</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">New Payroll Run</h1>
        <p className="text-muted-foreground">Create a payroll run for a given month. Employee entries are generated separately.</p>
      </div>

      <form action={formAction} className="space-y-6">
        {state.error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-500/5 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {state.error}
          </div>
        )}

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Month <span className="text-destructive">*</span>
              </label>
              <select
                name="month"
                defaultValue={now.getMonth() + 1}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.month ? "border-destructive" : "border-border"}`}
              >
                {MONTH_NAMES.slice(1).map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
              {state.fieldErrors?.month && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.month}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Year <span className="text-destructive">*</span>
              </label>
              <select
                name="year"
                defaultValue={currentYear}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.year ? "border-destructive" : "border-border"}`}
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              {state.fieldErrors?.year && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.year}</p>}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Notes</label>
            <textarea
              name="notes"
              rows={2}
              placeholder="Any notes for this payroll run..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-500/5 p-4 text-sm text-blue-700 dark:border-blue-900 dark:text-blue-400">
          After creating the run, use <strong>Generate Entries</strong> on the detail page to auto-calculate salaries and deductions for all active employees.
        </div>

        <div className="flex justify-end gap-3">
          <Link href="/dashboard/hr/payroll" className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? "Creating..." : "Create Payroll Run"}
          </button>
        </div>
      </form>
    </div>
  );
}

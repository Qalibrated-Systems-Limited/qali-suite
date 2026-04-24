"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { postDepreciation } from "@/app/mongodb/actions/asset-actions";

const MONTHS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const initialState = {
  success: false,
  error: null,
  period: null,
  processedCount: 0,
  totalAmount: 0,
  journalEntryIds: [],
};

export default function PostDepreciationDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    postDepreciation,
    initialState
  );

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(String(currentYear));

  const years = [currentYear - 1, currentYear, currentYear + 1];

  useEffect(() => {
    if (state.success) {
      toast.success(
        `Posted depreciation for ${state.processedCount} asset(s)`
      );
      router.refresh();
    }
  }, [state.success, state.processedCount, router]);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        variant="outline"
        className="gap-2"
      >
        <Calendar className="h-4 w-4" />
        <span className="hidden sm:inline">Post Depreciation</span>
      </Button>
    );
  }

  const period = `${year}-${month}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">
          Post Depreciation
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Post monthly depreciation for all active assets with pending entries
          for the selected period.
        </p>

        <form action={formAction} className="mt-4 space-y-4">
          <input type="hidden" name="period" value={period} />

          {state.error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-500/5 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {state.error}
            </div>
          )}

          {state.success && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  Posted {state.processedCount} asset(s) for {state.period}
                </p>
                <p className="text-xs">
                  Total KES{" "}
                  {(state.totalAmount || 0).toLocaleString("en-KE", {
                    minimumFractionDigits: 0,
                  })}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Month <span className="text-destructive">*</span>
              </label>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Year <span className="text-destructive">*</span>
              </label>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-md border border-blue-200 bg-blue-500/5 p-3 text-sm text-blue-700 dark:border-blue-900 dark:text-blue-400">
            <p>
              Running for period <strong className="font-mono">{period}</strong>
              . This will create a journal entry per asset with a pending
              depreciation entry for this period.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Close
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {isPending ? "Posting..." : "Post Depreciation"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

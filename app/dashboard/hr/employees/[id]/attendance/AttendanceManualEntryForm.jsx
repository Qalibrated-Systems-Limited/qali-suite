"use client";

import { useState, useActionState } from "react";
import { Pencil, ChevronDown, ChevronUp, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordManualAttendance } from "@/app/db/actions/hr-attendance-actions";

const initial = { success: false, error: null };

/** Today, on the LOCAL calendar — `toISOString()` is UTC and shifts the day. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AttendanceManualEntryForm({ employeeId, timezone }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(recordManualAttendance, initial);

  const max = today();
  if (state.success && open) setOpen(false);

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
      >
        <span className="flex items-center gap-2">
          <Pencil className="h-4 w-4 text-muted-foreground" />
          Record or correct a day
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <form action={formAction} className="border-t border-border px-4 pb-4 pt-4">
          <input type="hidden" name="employeeId" value={employeeId} />

          {state.error && (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 p-2 text-xs text-red-700 dark:border-red-900 dark:text-red-400">
              <AlertCircle className="h-3 w-3" /> {state.error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Date</label>
              <input
                name="date"
                type="date"
                defaultValue={max}
                max={max}
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
              <select
                name="status"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="half_day">Half day</option>
                <option value="on_leave">On leave</option>
                <option value="holiday">Holiday</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Shift</label>
              <select
                name="shift"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="night">Night</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Clocked in
              </label>
              <input
                name="checkIn"
                type="time"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Clocked out
              </label>
              <input
                name="checkOut"
                type="time"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Note</label>
              <input
                name="notes"
                type="text"
                placeholder="Why this was corrected"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Times are {timezone || "local"} wall-clock. Hours worked and overtime
            are computed from the company&apos;s standard day, not assumed to be eight.
          </p>

          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

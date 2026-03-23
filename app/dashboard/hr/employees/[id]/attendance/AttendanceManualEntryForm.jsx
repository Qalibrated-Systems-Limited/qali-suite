"use client";

import { useState, useActionState } from "react";
import { Pencil, ChevronDown, ChevronUp, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { manualAttendanceEntry } from "@/app/mongodb/actions/hr-attendance-actions";

const initial = { success: false, error: null };

export default function AttendanceManualEntryForm({ profileId }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(manualAttendanceEntry, initial);

  const today = new Date().toISOString().slice(0, 10);

  if (state.success && open) setOpen(false);

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Pencil className="h-4 w-4 text-muted-foreground" />
          Manual Entry / Override
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <form action={formAction} className="border-t border-border px-4 pb-4 pt-4">
          <input type="hidden" name="profileId" value={profileId} />

          {state.error && (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 p-2 text-xs text-red-700 dark:border-red-900 dark:text-red-400">
              <AlertCircle className="h-3 w-3" /> {state.error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {/* Date */}
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Date</label>
              <input
                name="date"
                type="date"
                defaultValue={today}
                max={today}
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Status */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
              <select
                name="status"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="half-day">Half Day</option>
                <option value="on-leave">On Leave</option>
                <option value="holiday">Holiday</option>
              </select>
            </div>

            {/* Shift */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Shift</label>
              <select
                name="shift"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="morning">Morning (08:00–17:00)</option>
                <option value="afternoon">Afternoon (14:00–22:00)</option>
                <option value="night">Night (22:00–06:00)</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            {/* Check In */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Check In (HH:MM)</label>
              <input
                name="checkIn"
                type="time"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Check Out */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Check Out (HH:MM)</label>
              <input
                name="checkOut"
                type="time"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Notes */}
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes</label>
              <input
                name="notes"
                type="text"
                placeholder="Override reason..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Save Entry
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

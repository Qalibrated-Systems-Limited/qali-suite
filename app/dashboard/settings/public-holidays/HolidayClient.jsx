"use client";

import { useState, useActionState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createPublicHoliday, deletePublicHoliday, seedKenyaHolidays } from "@/app/mongodb/actions/hr-holiday-actions";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const initial = { success: false, error: null, fieldErrors: null };

function HolidayRow({ holiday, canEdit }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm(`Delete "${holiday.name}"?`)) return;
    startTransition(async () => {
      const result = await deletePublicHoliday(holiday._id);
      if (result?.success === false) toast.error(result.error);
      else { toast.success("Holiday removed"); router.refresh(); }
    });
  }

  const dateLabel = holiday.isRecurring
    ? `${MONTHS[holiday.month - 1]} ${holiday.day} (every year)`
    : `${MONTHS[holiday.month - 1]} ${holiday.day}, ${holiday.year}`;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border last:border-0">
      <div>
        <p className="text-sm font-medium text-foreground">{holiday.name}</p>
        <p className="text-xs text-muted-foreground">{dateLabel}</p>
      </div>
      {canEdit && (
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          title="Remove holiday"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

function AddHolidayForm({ onSuccess }) {
  const [state, formAction, isPending] = useActionState(createPublicHoliday, initial);
  const [isRecurring, setIsRecurring] = useState(true);

  useEffect(() => {
    if (state.success) { toast.success("Holiday added"); onSuccess?.(); }
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-semibold text-foreground">Add Holiday</p>

      {state.error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:text-red-400">
          <AlertCircle className="h-3 w-3 shrink-0" /> {state.error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-foreground">Holiday Name</label>
          <input
            name="name"
            type="text"
            placeholder="e.g. Idd ul-Fitr"
            className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${state.fieldErrors?.name ? "border-destructive" : "border-border"}`}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Month</label>
          <select name="month" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Day</label>
          <input name="day" type="number" min="1" max="31" placeholder="e.g. 25"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required />
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} className="accent-primary" />
            <input type="hidden" name="isRecurring" value={isRecurring ? "true" : "false"} />
            <span className="text-sm text-foreground">Recurring every year</span>
          </label>
          <p className="mt-1 text-xs text-muted-foreground">Uncheck for one-off holidays (election day, national mourning, etc.)</p>
        </div>
        {!isRecurring && (
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Year</label>
            <input name="year" type="number" min="2020" max="2100" placeholder={new Date().getFullYear().toString()}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" required />
          </div>
        )}
      </div>

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
        <Plus className="h-3 w-3" /> Add Holiday
      </Button>
    </form>
  );
}

export default function HolidayClient({ initialHolidays, canEdit }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [seeding, startSeed] = useTransition();

  function handleSeed() {
    startSeed(async () => {
      const result = await seedKenyaHolidays();
      if (result?.success === false) toast.error(result.error);
      else toast.success(result.message || `Added ${result.inserted} Kenya public holidays`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* List */}
      <div className="rounded-lg border border-border bg-card shadow-sm">
        {initialHolidays.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No public holidays configured. Seed Kenya defaults or add manually.
          </div>
        ) : (
          initialHolidays.map((h) => (
            <HolidayRow key={h._id} holiday={h} canEdit={canEdit} />
          ))
        )}
      </div>

      {/* Actions */}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" /> Add Holiday
          </Button>
          <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding}>
            {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Seed Kenya Defaults
          </Button>
        </div>
      )}

      {canEdit && showForm && (
        <AddHolidayForm onSuccess={() => { setShowForm(false); router.refresh(); }} />
      )}
    </div>
  );
}

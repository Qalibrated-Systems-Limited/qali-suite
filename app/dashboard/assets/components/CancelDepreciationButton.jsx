"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cancelDepreciationPosting } from "@/app/mongodb/actions/asset-actions";

const initialState = {
  success: false,
  error: null,
  assetId: null,
  period: null,
};

export default function CancelDepreciationButton({ assetId, period }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    cancelDepreciationPosting,
    initialState
  );

  useEffect(() => {
    if (state.success) {
      toast.success(`Cancelled depreciation for ${state.period}`);
      setOpen(false);
      router.refresh();
    }
  }, [state.success, state.period, router]);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        variant="outline"
      >
        <Undo2 className="h-4 w-4" />
        <span className="hidden sm:inline">Cancel Last Depreciation</span>
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">
          Cancel Depreciation
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This will reverse the journal entry for the most recent posted period
          (<span className="font-mono">{period}</span>) and mark the schedule
          entry as pending.
        </p>

        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="assetId" value={assetId} />
          <input type="hidden" name="period" value={period} />

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" /> {state.error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Reason (optional)
            </label>
            <textarea
              name="reason"
              rows={3}
              maxLength={500}
              placeholder="Why are you cancelling this depreciation?"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={isPending}
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Confirm
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

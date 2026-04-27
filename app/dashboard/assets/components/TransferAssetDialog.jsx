"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { transferAsset } from "@/app/mongodb/actions/asset-actions";

const initialState = {
  success: false,
  error: null,
  fieldErrors: null,
  assetId: null,
};

export default function TransferAssetDialog({ asset }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    transferAsset,
    initialState,
  );

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (state.success) {
      toast.success("Asset transfer recorded");
      setOpen(false);
      router.refresh();
    }
  }, [state.success, router]);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        variant="outline"
        className="gap-1.5"
      >
        <ArrowRightLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Transfer</span>
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">
          Transfer Asset
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Move {asset.name} ({asset.assetNumber}) to a new location, department,
          or custodian.
        </p>

        <form action={formAction} className="mt-4 space-y-4">
          <input type="hidden" name="assetId" value={asset._id} />

          {state.error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-500/5 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {state.error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Transfer Date
            </label>
            <input
              type="date"
              name="transferredAt"
              defaultValue={today}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              New Location
            </label>
            <input
              type="text"
              name="toLocation"
              defaultValue={asset.location || ""}
              maxLength={200}
              placeholder="e.g. Mombasa Branch"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {asset.location && (
              <p className="mt-1 text-xs text-muted-foreground">
                Currently at: {asset.location}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              New Department
            </label>
            <input
              type="text"
              name="toDepartment"
              defaultValue={asset.department || ""}
              maxLength={100}
              placeholder="e.g. Sales"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {asset.department && (
              <p className="mt-1 text-xs text-muted-foreground">
                Currently in: {asset.department}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              New Custodian
            </label>
            <input
              type="text"
              name="toAssignedToName"
              defaultValue={asset.assignedToName || ""}
              maxLength={200}
              placeholder="e.g. Jane Doe"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {asset.assignedToName && (
              <p className="mt-1 text-xs text-muted-foreground">
                Currently assigned to: {asset.assignedToName}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Reason <span className="text-destructive">*</span>
            </label>
            <textarea
              name="reason"
              required
              rows={2}
              maxLength={500}
              placeholder="e.g. Reassigned to new branch manager"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                </>
              ) : (
                "Record Transfer"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

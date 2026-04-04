"use client";

import { useState, useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { voidWeighbridgeTicket } from "@/app/mongodb/actions/integration-actions";

// ============================================
// VOID TICKET BUTTON
// Admin-only. Shows on pending, first_recorded,
// and completed tickets.
//
// Completed tickets trigger full reversal of
// the stock movement and journal entry.
// ============================================

export function VoidTicketButton({ ticketId, ticketNumber, status }) {
  const [open, setOpen]       = useState(false);
  const [reason, setReason]   = useState("");
  const [error, setError]     = useState(null);
  const [isPending, startTransition] = useTransition();

  function handleOpen() {
    setReason("");
    setError(null);
    setOpen(true);
  }

  function handleCancel() {
    if (isPending) return;
    setOpen(false);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Void reason is required");
      return;
    }

    startTransition(async () => {
      const result = await voidWeighbridgeTicket(ticketId, reason.trim());
      if (result?.error) {
        setError(result.error);
      } else {
        setOpen(false);
      }
    });
  }

  const isCompleted = status === "completed";

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400 transition-colors"
        title={`Void ${ticketNumber}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Void
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
            <h2 className="text-base font-semibold text-foreground">
              Void ticket {ticketNumber}
            </h2>

            {isCompleted && (
              <div className="mt-3 rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-400">
                <strong>Completed ticket.</strong> Voiding will reverse the stock movement
                and journal entry created when this ticket was completed.
                This cannot be undone.
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Wrong vehicle registration, duplicate entry, operator error..."
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  disabled={isPending}
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isPending}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !reason.trim()}
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isPending ? "Voiding…" : "Void ticket"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

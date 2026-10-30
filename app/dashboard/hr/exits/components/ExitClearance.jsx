"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { CheckCircle2, Circle, MinusCircle, Loader2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  setClearanceStatus,
  removeClearanceItem,
  addClearanceItem,
} from "@/app/db/actions/hr-exit-actions";

const ICON = {
  cleared: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
  waived: <MinusCircle className="h-4 w-4 text-muted-foreground" />,
  pending: <Circle className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
};

function Item({ exitId, item, editable }) {
  const [isPending, startTransition] = useTransition();
  const [waiving, setWaiving] = useState(false);
  const [note, setNote] = useState("");

  const run = (fn) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.success) toast.error(res.error);
      else setWaiving(false);
    });

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{ICON[item.status]}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${item.status === "waived" ? "text-muted-foreground line-through" : "text-foreground"}`}>
            {item.item}
          </p>
          {item.status !== "pending" && (
            <p className="text-xs text-muted-foreground">
              {item.status === "cleared" ? "Cleared" : "Waived"} by {item.clearedByName}
              {item.clearedAt ? ` · ${new Date(item.clearedAt).toLocaleDateString("en-KE")}` : ""}
              {item.note ? ` — ${item.note}` : ""}
            </p>
          )}
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-1">
            {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {item.status === "pending" ? (
              <>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => setClearanceStatus(exitId, item.id, "cleared"))}
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setWaiving((w) => !w)}
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                >
                  Waive
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  aria-label="Remove item"
                  onClick={() => run(() => removeClearanceItem(exitId, item.id))}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => setClearanceStatus(exitId, item.id, "pending"))}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Undo
              </button>
            )}
          </div>
        )}
      </div>
      {waiving && (
        <div className="mt-2 flex gap-2 pl-7">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this being waived?"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => setClearanceStatus(exitId, item.id, "waived", note))}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
          >
            Waive
          </button>
        </div>
      )}
    </li>
  );
}

function AddItem({ exitId }) {
  const [state, formAction, isPending] = useActionState(addClearanceItem, { success: false });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state.success) setOpen(false);
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <Plus className="h-4 w-4" /> Add an item
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
      <input type="hidden" name="exitId" value={exitId} />
      <input
        name="area"
        placeholder="Area, e.g. Finance"
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground sm:w-40"
      />
      <input
        name="item"
        placeholder="What has to be cleared"
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
      />
      <button type="submit" disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
        Add
      </button>
    </form>
  );
}

export default function ExitClearance({ exitId, items, editable }) {
  const areas = [...new Set(items.map((i) => i.area))];
  const open = items.filter((i) => i.status === "pending").length;

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-semibold text-foreground">Clearance</h2>
        <span className={`text-xs ${open ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
          {open ? `${open} of ${items.length} open` : "Complete"}
        </span>
      </div>
      <div className="space-y-4 px-4 py-2">
        {areas.map((area) => (
          <div key={area}>
            <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{area}</p>
            <ul className="divide-y divide-border">
              {items
                .filter((i) => i.area === area)
                .map((item) => (
                  <Item key={item.id} exitId={exitId} item={item} editable={editable} />
                ))}
            </ul>
          </div>
        ))}
        {editable && (
          <div className="pb-3">
            <AddItem exitId={exitId} />
          </div>
        )}
      </div>
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import { createPettyCashReturnPg } from "@/app/db/actions/petty-cash-actions";
import { toast } from "sonner";

// Opens a new petty cash return for a date range against a chosen float, then
// jumps to the detail page where the custodian records entries.
export default function NewPettyCashReturn({ floats = [] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [floatAccountId, setFloatAccountId] = useState(floats[0]?._id || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function handleCreate() {
    if (!floatAccountId) return toast.error("Select a petty cash account");
    if (!from || !to) return toast.error("Pick a from and to date");
    if (new Date(from) > new Date(to)) return toast.error("From date is after to date");
    startTransition(async () => {
      const res = await createPettyCashReturnPg({
        floatAccountId,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
      if (res.success) {
        toast.success(`Opened ${res.documentNumber}`);
        router.push(`/dashboard/petty-cash/${res.returnId}`);
      } else {
        toast.error(res.error || "Failed to open return");
      }
    });
  }

  if (floats.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        No petty cash account found. Create a Cash account (sub-type Cash) first.
      </Card>
    );
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold shrink-0 sm:size-default"
      >
        <Plus className="h-4 w-4 sm:mr-2" />
        <span className="hidden sm:inline">New return</span>
      </Button>
    );
  }

  return (
    <Card className="p-4 flex flex-col sm:flex-row gap-2 sm:items-end">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Petty cash account</label>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={floatAccountId}
          onChange={(e) => setFloatAccountId(e.target.value)}
        >
          {floats.map((f) => (
            <option key={f._id} value={f._id}>
              {f.accountName}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">From</label>
        <input
          type="date"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">To</label>
        <input
          type="date"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button onClick={handleCreate} disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Open"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

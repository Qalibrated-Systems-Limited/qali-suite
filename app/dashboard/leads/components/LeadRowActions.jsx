"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowRightCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  convertLead,
  setLeadStatus,
} from "@/app/mongodb/actions/lead-actions";

// Inline per-row controls: advance the lead's status, or convert it into a
// customer + opportunity. Converted/unqualified leads are terminal — no
// actions shown.
export default function LeadRowActions({ leadId, status }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  if (status === "converted" || status === "unqualified") {
    return (
      <span className="text-xs text-muted-foreground">
        {status === "converted" ? "Converted" : "Closed"}
      </span>
    );
  }

  const run = (fn, okMsg) =>
    startTransition(async () => {
      setBusy(true);
      const res = await fn();
      setBusy(false);
      if (res?.success) {
        toast.success(okMsg);
        router.refresh();
      } else {
        toast.error(res?.error || "Action failed");
      }
    });

  const onStatus = (e) => {
    const next = e.target.value;
    if (!next) return;
    e.target.value = "";
    if (next === "unqualified") {
      const note = window.prompt("Reason for marking unqualified?") || "";
      run(() => setLeadStatus(leadId, "unqualified", note), "Marked unqualified");
    } else {
      run(() => setLeadStatus(leadId, next), `Marked ${next}`);
    }
  };

  const onConvert = () =>
    run(() => convertLead(leadId, new FormData()), "Converted to customer + opportunity");

  const disabled = isPending || busy;

  return (
    <div className="flex items-center justify-end gap-2">
      <select
        defaultValue=""
        onChange={onStatus}
        disabled={disabled}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
      >
        <option value="" disabled>
          Set status…
        </option>
        <option value="contacted">Contacted</option>
        <option value="qualified">Qualified</option>
        <option value="unqualified">Unqualified</option>
      </select>
      <Button size="sm" variant="outline" disabled={disabled} onClick={onConvert}>
        {disabled ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArrowRightCircle className="mr-1.5 h-3.5 w-3.5" />
        )}
        Convert
      </Button>
    </div>
  );
}

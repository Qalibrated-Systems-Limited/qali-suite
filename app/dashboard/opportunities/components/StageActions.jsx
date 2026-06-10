"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trophy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  advanceOpportunityStage,
  closeOpportunity,
} from "@/app/mongodb/actions/opportunity-actions";

const OPEN_STAGES = ["qualification", "needs_analysis", "proposal", "negotiation"];
const STAGE_LABEL = {
  qualification: "Qualification",
  needs_analysis: "Needs analysis",
  proposal: "Proposal",
  negotiation: "Negotiation",
};
const LOST_REASONS = ["price", "competitor", "timing", "no_budget", "no_decision", "other"];

export default function StageActions({ opportunityId, stage }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const run = (fn, okMsg) =>
    startTransition(async () => {
      const res = await fn();
      if (res?.success) {
        toast.success(okMsg);
        router.refresh();
      } else {
        toast.error(res?.error || "Action failed");
      }
    });

  const onMove = (e) => {
    const next = e.target.value;
    e.target.value = "";
    if (next) run(() => advanceOpportunityStage(opportunityId, next), `Moved to ${STAGE_LABEL[next]}`);
  };

  const onWon = () =>
    startTransition(async () => {
      const res = await closeOpportunity(opportunityId, "won", new FormData());
      if (res?.success) {
        toast.success(`Won 🎉 — draft quote ${res.data?.quoteNumber || ""} created`);
        if (res.data?.quoteId) router.push(`/dashboard/quotes/${res.data.quoteId}`);
        else router.refresh();
      } else {
        toast.error(res?.error || "Action failed");
      }
    });

  const onLost = () => {
    const reason = (window.prompt(`Lost reason (${LOST_REASONS.join(", ")})`) || "").trim();
    const fd = new FormData();
    fd.set("lostReason", LOST_REASONS.includes(reason) ? reason : "other");
    run(() => closeOpportunity(opportunityId, "lost", fd), "Marked Lost");
  };

  return (
    <div className="mt-2 flex items-center gap-1.5">
      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      <select
        defaultValue=""
        onChange={onMove}
        disabled={isPending}
        className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]"
        title="Move stage"
      >
        <option value="" disabled>
          Move…
        </option>
        {OPEN_STAGES.filter((s) => s !== stage).map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </select>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-emerald-600"
        disabled={isPending}
        onClick={onWon}
        title="Mark won"
      >
        <Trophy className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-destructive"
        disabled={isPending}
        onClick={onLost}
        title="Mark lost"
      >
        <XCircle className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Play,
  Pause,
  CheckCircle2,
  Lock,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { updateProjectStatus } from "@/app/db/actions/project-actions";
import { toast } from "sonner";

const TRANSITIONS = {
  planning: [
    { status: "active", label: "Start Project", icon: Play, variant: "default" },
  ],
  active: [
    { status: "on_hold", label: "Put On Hold", icon: Pause, variant: "outline" },
    { status: "completed", label: "Mark Completed", icon: CheckCircle2, variant: "default" },
  ],
  on_hold: [
    { status: "active", label: "Resume", icon: Play, variant: "default" },
  ],
  completed: [
    { status: "closed", label: "Close Project", icon: Lock, variant: "outline", adminOnly: true },
  ],
  closed: [],
};

/**
 * CLOSING IS THE ONLY TERMINAL TRANSITION — `closed` has no way back out, and a
 * closed project then refuses edits, roster changes, time and variations. The
 * action refuses to close over outstanding retention, an uninvoiced
 * certificate, an open draft, unapproved time or an undecided variation; this
 * says so BEFORE the button rather than as a toast afterwards, because by then
 * the person has already decided the job is finished.
 */
export default function ProjectStatusActions({
  projectId,
  currentStatus,
  userRole,
  closingBlockers = [],
}) {
  const [isPending, startTransition] = useTransition();
  const [loadingStatus, setLoadingStatus] = useState(null);

  const transitions = TRANSITIONS[currentStatus] || [];

  // Filter by role
  const availableTransitions = transitions.filter((t) => {
    if (t.adminOnly && !["SuperAdmin", "Admin", "Accountant"].includes(userRole)) return false;
    return true;
  });

  if (availableTransitions.length === 0) return null;

  const handleTransition = (newStatus) => {
    setLoadingStatus(newStatus);
    startTransition(async () => {
      const result = await updateProjectStatus(projectId, newStatus);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.error);
      }
      setLoadingStatus(null);
    });
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">Actions:</span>
        {availableTransitions.map((t) => {
          const Icon = t.icon;
          const isLoading = isPending && loadingStatus === t.status;
          const blocked = t.status === "closed" && closingBlockers.length > 0;
          return (
            <Button
              key={t.status}
              variant={t.variant}
              size="sm"
              onClick={() => handleTransition(t.status)}
              disabled={isPending || blocked}
              title={
                blocked
                  ? "Settle what is outstanding before closing — closing is final."
                  : undefined
              }
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Icon className="h-4 w-4 mr-1" />
              )}
              {t.label}
            </Button>
          );
        })}
      </div>

      {closingBlockers.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-amber-900 dark:text-amber-200">
            <p className="font-medium">This project cannot be closed yet.</p>
            <ul className="mt-1 space-y-0.5">
              {closingBlockers.map((b) => (
                <li key={b.kind}>• {b.detail}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

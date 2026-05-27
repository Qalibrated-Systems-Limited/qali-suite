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
} from "lucide-react";
import { updateProjectStatus } from "@/app/mongodb/actions/project-actions";
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

export default function ProjectStatusActions({
  projectId,
  currentStatus,
  userRole,
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
          return (
            <Button
              key={t.status}
              variant={t.variant}
              size="sm"
              onClick={() => handleTransition(t.status)}
              disabled={isPending}
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
    </Card>
  );
}

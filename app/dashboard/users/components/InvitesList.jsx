"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Send,
  X,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Mail,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { resendInvite, cancelInvite } from "@/app/mongodb/actions/invite-actions";
import { toast } from "sonner";

function StatusBadge({ status, isExpired }) {
  if (status === "accepted") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" />
        Accepted
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/10 text-gray-600 dark:text-gray-400">
        <XCircle className="h-3 w-3" />
        Cancelled
      </span>
    );
  }
  if (isExpired) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" />
        Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
      <Clock className="h-3 w-3" />
      Pending
    </span>
  );
}

function InviteRow({ invite }) {
  const [isPending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  const canResend = invite.status === "pending" && !invite.isExpired;
  const canCancel = invite.status === "pending";

  const handleResend = () => {
    startTransition(async () => {
      const result = await resendInvite(invite._id);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleCancel = () => {
    startTransition(async () => {
      const result = await cancelInvite(invite._id);
      if (result.success) {
        toast.success(result.message);
        setHidden(true);
      } else {
        toast.error(result.error);
      }
    });
  };

  if (hidden) return null;

  return (
    <div className="flex items-center justify-between gap-4 py-3 px-4 border-b border-border last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">
            {invite.email}
          </span>
          <StatusBadge status={invite.status} isExpired={invite.isExpired} />
          <span className="text-xs text-muted-foreground">{invite.role}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Invited by {invite.invitedBy} &middot;{" "}
          {new Date(invite.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>

      {(canResend || canCancel) && (
        <div className="flex items-center gap-1 shrink-0">
          {canResend && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={handleResend}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Send className="h-3.5 w-3.5 mr-1" />
                  Resend
                </>
              )}
            </Button>
          )}
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-500/10"
              onClick={handleCancel}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <X className="h-3.5 w-3.5 mr-1" />
                  Cancel
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function InvitesList({ invites }) {
  const [expanded, setExpanded] = useState(false);

  if (!invites || invites.length === 0) return null;

  const pendingInvites = invites.filter(
    (inv) => inv.status === "pending" && !inv.isExpired
  );
  const otherInvites = invites.filter(
    (inv) => inv.status !== "pending" || inv.isExpired
  );

  const displayInvites = expanded
    ? [...pendingInvites, ...otherInvites]
    : pendingInvites;

  if (pendingInvites.length === 0 && !expanded) {
    return null;
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            Pending Invites
          </h3>
          {pendingInvites.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium">
              {pendingInvites.length}
            </span>
          )}
        </div>
        {otherInvites.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                Hide history <ChevronUp className="h-3.5 w-3.5 ml-1" />
              </>
            ) : (
              <>
                Show all ({invites.length}){" "}
                <ChevronDown className="h-3.5 w-3.5 ml-1" />
              </>
            )}
          </Button>
        )}
      </div>

      <div>
        {displayInvites.length > 0 ? (
          displayInvites.map((invite) => (
            <InviteRow key={invite._id} invite={invite} />
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-6">
            No pending invites
          </p>
        )}
      </div>
    </div>
  );
}

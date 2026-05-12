"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  proposeDisposition,
  authorizeDisposition,
  closeNCR,
  cancelNCR,
} from "@/app/mongodb/actions/ncr-actions";

const DISPOSITION_OPTIONS = [
  { value: "return_to_supplier", label: "Return to supplier" },
  { value: "repair", label: "Repair / refurbish" },
  { value: "downgrade", label: "Downgrade for alternative use" },
  { value: "scrap", label: "Scrap / write-off" },
  { value: "accept_as_is", label: "Accept as-is" },
];

export default function NCRActions({ ncr, currentUser }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [proposing, setProposing] = useState(false);
  const [dispoType, setDispoType] = useState("return_to_supplier");
  const [dispoReason, setDispoReason] = useState("");

  const [authNotes, setAuthNotes] = useState("");
  const [closeNotes, setCloseNotes] = useState("");

  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const role = currentUser?.role;
  const canPropose = [
    "SuperAdmin",
    "Admin",
    "Manager",
    "Store Manager",
    "CFO",
    "Finance Manager",
  ].includes(role);
  const canAuthorize = ["SuperAdmin", "Admin", "CFO"].includes(role);

  const run = (fn, msg) => {
    setError("");
    setSuccess("");
    startTransition(async () => {
      const res = await fn();
      if (res?.success) {
        if (msg) setSuccess(msg);
        router.refresh();
      } else {
        setError(res?.error || "Action failed");
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* Propose disposition (open status) */}
      {ncr.status === "open" && canPropose && (
        <div className="space-y-2">
          {!proposing ? (
            <Button
              onClick={() => setProposing(true)}
              disabled={isPending}
              className="gap-1.5"
            >
              <Send className="h-4 w-4" />
              Propose disposition
            </Button>
          ) : (
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <select
                value={dispoType}
                onChange={(e) => setDispoType(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {DISPOSITION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <textarea
                value={dispoReason}
                onChange={(e) => setDispoReason(e.target.value)}
                placeholder="Reason (will appear on the audit trail)"
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    run(
                      () => proposeDisposition(ncr._id, dispoType, dispoReason),
                      "Disposition proposed — awaiting authorization",
                    )
                  }
                  disabled={isPending || !dispoReason.trim()}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Propose"
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setProposing(false);
                    setDispoReason("");
                  }}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Authorize (disposition_proposed) */}
      {ncr.status === "disposition_proposed" && canAuthorize && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 dark:bg-purple-900/10 p-3 space-y-2">
          <p className="text-sm">
            <strong>{ncr.disposition.proposedBy?.name}</strong> has proposed{" "}
            <strong>
              {ncr.disposition.type
                ?.replaceAll("_", " ")
                .replace(/^./, (c) => c.toUpperCase())}
            </strong>
            . As MD-equivalent, authorize or send back.
          </p>
          <textarea
            value={authNotes}
            onChange={(e) => setAuthNotes(e.target.value)}
            placeholder="Authorization notes (optional)"
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <Button
              onClick={() =>
                run(
                  () => authorizeDisposition(ncr._id, authNotes),
                  "Disposition authorized",
                )
              }
              disabled={isPending}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              <CheckCircle2 className="h-4 w-4" />
              Authorize
            </Button>
          </div>
        </div>
      )}

      {/* Close (authorized) */}
      {ncr.status === "authorized" && canPropose && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 p-3 space-y-2">
          <p className="text-sm">
            Disposition authorized. Once executed (item returned, repaired,
            scrapped, etc.), close this NCR.
          </p>
          <textarea
            value={closeNotes}
            onChange={(e) => setCloseNotes(e.target.value)}
            placeholder="Execution notes — what was actually done?"
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <Button
            onClick={() =>
              run(() => closeNCR(ncr._id, closeNotes), "NCR closed")
            }
            disabled={isPending || !closeNotes.trim()}
            className="gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" />
            Mark as closed
          </Button>
        </div>
      )}

      {/* Cancel — any non-terminal status, AUTHORIZE roles only */}
      {!["closed", "cancelled"].includes(ncr.status) && canAuthorize && (
        <div>
          {!cancelling ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCancelling(true)}
              className="text-red-600 hover:text-red-700 gap-1.5"
            >
              <XCircle className="h-4 w-4" />
              Cancel NCR
            </Button>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/10 p-3 space-y-2">
              <p className="text-sm text-red-700 dark:text-red-300">
                Cancel only if this NCR was raised in error.
              </p>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Cancellation reason (required)"
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={() =>
                    run(
                      () => cancelNCR(ncr._id, cancelReason),
                      "NCR cancelled",
                    )
                  }
                  disabled={isPending || !cancelReason.trim()}
                >
                  Confirm cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCancelling(false);
                    setCancelReason("");
                  }}
                  disabled={isPending}
                >
                  Back
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {(error || success) && (
        <div
          className={`inline-flex items-center gap-1.5 text-xs ${
            error ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {error ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {error || success}
        </div>
      )}
    </div>
  );
}

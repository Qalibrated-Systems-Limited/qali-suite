"use client";

import { useState, useTransition } from "react";
import { deleteWebhookSubscription, resumeWebhookSubscription } from "@/app/mongodb/actions/integration-actions";
import { Globe, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";

const CONNECTOR_LABELS = {
  weighbridge:  "Weighbridge",
  coffee_coop:  "Coffee Collection",
  logistics:    "Logistics / TMS",
  miller:       "Miller / Production",
  generic:      "Generic",
};

function formatRelative(isoString) {
  if (!isoString) return null;
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export default function WebhookCard({ webhook }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteWebhookSubscription(webhook._id);
      setConfirming(false);
    });
  }

  function handleResume() {
    startTransition(async () => {
      await resumeWebhookSubscription(webhook._id);
    });
  }

  return (
    <div className={`rounded-lg border bg-card shadow-sm ${webhook.suspended ? "border-red-200 dark:border-red-900" : "border-border"}`}>
      <div className="p-4">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              webhook.suspended
                ? "bg-red-500/15 text-red-600 dark:text-red-400"
                : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
            }`}>
              {webhook.suspended
                ? <AlertCircle className="h-4 w-4" />
                : <Globe className="h-4 w-4" />
              }
            </div>
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{webhook.name}</p>
              <p className="font-mono text-xs text-muted-foreground truncate">{webhook.url}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {webhook.suspended && (
              <span className="inline-flex rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                Suspended
              </span>
            )}
            {webhook.connectorType && (
              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {CONNECTOR_LABELS[webhook.connectorType] ?? webhook.connectorType}
              </span>
            )}
          </div>
        </div>

        {/* Suspended warning */}
        {webhook.suspended && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Suspended after {webhook.failureCount} consecutive failures
              {webhook.lastFailureAt && ` — last failed ${formatRelative(webhook.lastFailureAt)}`}.
              Fix the endpoint then resume.
            </span>
          </div>
        )}

        {/* Events */}
        <div className="mt-3 flex flex-wrap gap-1">
          {webhook.events.map((e) => (
            <span key={e} className="inline-flex rounded bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {e}
            </span>
          ))}
        </div>

        {webhook.notes && (
          <p className="mt-2 text-xs text-muted-foreground">{webhook.notes}</p>
        )}

        {/* Actions */}
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          {webhook.suspended ? (
            <button
              onClick={handleResume}
              disabled={isPending}
              className="flex items-center gap-1 text-xs text-emerald-600 hover:underline dark:text-emerald-400 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3 w-3" />
              {isPending ? "Resuming…" : "Resume deliveries"}
            </button>
          ) : (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Active
            </span>
          )}

          <div className="flex items-center gap-3">
            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                className="text-xs text-red-600 hover:underline dark:text-red-400"
              >
                Delete
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  Remove this webhook?
                </span>
                <button onClick={() => setConfirming(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isPending}
                  className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isPending ? "Deleting…" : "Confirm"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

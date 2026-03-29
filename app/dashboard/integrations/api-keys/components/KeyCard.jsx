"use client";

import { useState, useTransition } from "react";
import { revokeIntegrationKey } from "@/app/mongodb/actions/integration-actions";
import { Key, Clock, Wifi, WifiOff, AlertTriangle } from "lucide-react";

const CONNECTOR_LABELS = {
  weighbridge:  "Weighbridge",
  coffee_coop:  "Coffee Collection",
  logistics:    "Logistics / TMS",
  miller:       "Miller / Production",
  generic:      "Generic",
};

const CONNECTOR_COLORS = {
  weighbridge: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  coffee_coop: "bg-green-500/15 text-green-700 dark:text-green-400",
  logistics:   "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  miller:      "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  generic:     "bg-muted text-muted-foreground",
};

function formatRelative(isoString) {
  if (!isoString) return "Never";
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function KeyCard({ apiKey }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleRevoke() {
    startTransition(async () => {
      await revokeIntegrationKey(apiKey._id);
      setConfirming(false);
    });
  }

  return (
    <div className={`rounded-lg border bg-card shadow-sm transition-opacity ${!apiKey.isActive ? "opacity-60" : ""} ${
      apiKey.isActive ? "border-border" : "border-border"
    }`}>
      <div className="p-4">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              apiKey.isActive ? CONNECTOR_COLORS[apiKey.connectorType] : "bg-muted text-muted-foreground"
            }`}>
              {apiKey.isActive ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{apiKey.name}</p>
              <code className="text-xs text-muted-foreground font-mono">{apiKey.displayKey}</code>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
              CONNECTOR_COLORS[apiKey.connectorType]
            }`}>
              {CONNECTOR_LABELS[apiKey.connectorType] ?? apiKey.connectorType}
            </span>
            {!apiKey.isActive && (
              <span className="inline-flex rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                Revoked
              </span>
            )}
            {apiKey.environment === "test" && (
              <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                Test
              </span>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Last used: {formatRelative(apiKey.lastUsedAt)}
          </span>
          <span>{apiKey.totalRequests.toLocaleString()} requests</span>
          {apiKey.lastUsedIp && <span>{apiKey.lastUsedIp}</span>}
        </div>

        {/* Scopes */}
        {apiKey.scopes?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {apiKey.scopes.map((scope) => (
              <span key={scope} className="inline-flex rounded bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {scope}
              </span>
            ))}
          </div>
        )}

        {/* Notes */}
        {apiKey.notes && (
          <p className="mt-2 text-xs text-muted-foreground">{apiKey.notes}</p>
        )}

        {/* Revoke */}
        {apiKey.isActive && (
          <div className="mt-4 flex items-center justify-end border-t border-border pt-3">
            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                className="text-xs text-red-600 hover:underline dark:text-red-400"
              >
                Revoke key
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  This cannot be undone. External systems will lose access immediately.
                </span>
                <button
                  onClick={() => setConfirming(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRevoke}
                  disabled={isPending}
                  className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isPending ? "Revoking…" : "Confirm Revoke"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

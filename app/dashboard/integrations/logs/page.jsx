import Link from "next/link";
import { ChevronLeft, Activity } from "lucide-react";
import { getRecentSyncLogs } from "@/app/mongodb/actions/integration-actions";

export const metadata = { title: "Sync Logs | Integrations" };

const STATUS_STYLES = {
  processed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  failed:    "bg-red-500/15 text-red-700 dark:text-red-400",
  received:  "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  processing:"bg-amber-500/15 text-amber-700 dark:text-amber-400",
  skipped:   "bg-muted text-muted-foreground",
  retrying:  "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

const CONNECTOR_LABELS = {
  weighbridge: "Weighbridge",
  coffee_coop: "Coffee Collection",
  logistics:   "Logistics / TMS",
  miller:      "Miller / Production",
  generic:     "Generic",
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleString("en-KE", {
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

export default async function SyncLogsPage() {
  const logs = await getRecentSyncLogs(50);

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/integrations" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Integrations
        </Link>
        <span>/</span>
        <span className="text-foreground">Sync Logs</span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Sync Logs</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Complete audit trail of every request and webhook delivery. Showing last 50 entries.
        </p>
      </div>

      {logs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Activity className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No sync activity yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Connector</th>
                  <th className="px-4 py-3">External Ref</th>
                  <th className="px-4 py-3">Internal Ref</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log._id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          log.direction === "inbound"
                            ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                            : "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                        }`}>
                          {log.direction === "inbound" ? "IN" : "OUT"}
                        </span>
                        <span className="font-medium text-foreground">{log.event}</span>
                      </div>
                      {log.error && (
                        <p className="mt-0.5 text-xs text-red-600 dark:text-red-400 truncate max-w-xs">
                          {log.error}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {log.connectorType ? CONNECTOR_LABELS[log.connectorType] ?? log.connectorType : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[140px] truncate">
                      {log.externalRef || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-primary">
                      {log.internalRef || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(log.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="divide-y divide-border md:hidden">
            {logs.map((log) => (
              <div key={log._id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        log.direction === "inbound"
                          ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                          : "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                      }`}>
                        {log.direction === "inbound" ? "IN" : "OUT"}
                      </span>
                      <p className="text-sm font-medium text-foreground truncate">{log.event}</p>
                    </div>
                    {log.externalRef && (
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground truncate">{log.externalRef}</p>
                    )}
                    {log.error && (
                      <p className="mt-0.5 text-xs text-red-600 dark:text-red-400 truncate">{log.error}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={log.status} />
                    <span className="text-xs text-muted-foreground">{formatTime(log.createdAt)}</span>
                  </div>
                </div>
                {log.internalRef && (
                  <p className="mt-1 text-xs text-primary">{log.internalRef}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

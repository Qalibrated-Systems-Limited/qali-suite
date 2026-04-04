import Link from "next/link";
import { Key, ArrowUpRight, CheckCircle2, XCircle, Clock, Activity, Plus, Globe, Scale, Coffee } from "lucide-react";
import { getIntegrationStats, getRecentSyncLogs } from "@/app/mongodb/actions/integration-actions";

export const metadata = { title: "Integrations | Settings" };

const CONNECTOR_LABELS = {
  weighbridge:  "Weighbridge",
  coffee_coop:  "Coffee Collection",
  logistics:    "Logistics / TMS",
  miller:       "Miller / Production",
  generic:      "Generic",
};

const STATUS_STYLES = {
  processed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  failed:    "bg-red-500/15 text-red-700 dark:text-red-400",
  received:  "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  processing:"bg-amber-500/15 text-amber-700 dark:text-amber-400",
  skipped:   "bg-muted text-muted-foreground",
  retrying:  "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function StatCard({ label, value, icon: Icon, color = "text-foreground" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function formatRelative(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function IntegrationsPage() {
  const [stats, logs] = await Promise.all([
    getIntegrationStats(),
    getRecentSyncLogs(15),
  ]);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Integrations</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            API keys, connectors, and sync activity
          </p>
        </div>
        <Link
          href="/dashboard/integrations/api-keys"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New API Key</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active Keys" value={stats.keys.active} icon={Key} />
        <StatCard label="Total Requests" value={stats.keys.totalRequests.toLocaleString()} icon={Activity} />
        <StatCard label="Processed" value={stats.logs.processed.toLocaleString()} icon={CheckCircle2} color="text-emerald-600 dark:text-emerald-400" />
        <StatCard label="Failed" value={stats.logs.failed} icon={XCircle} color={stats.logs.failed > 0 ? "text-red-600 dark:text-red-400" : "text-foreground"} />
      </div>

      {/* Quick links */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/dashboard/integrations/api-keys"
          className="group flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Key className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-medium text-foreground">API Keys</p>
              <p className="text-xs text-muted-foreground">{stats.keys.total} key{stats.keys.total !== 1 ? "s" : ""} · {stats.keys.active} active</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>

        <Link
          href="/dashboard/integrations/webhooks"
          className="group flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10">
              <Globe className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="font-medium text-foreground">Webhooks</p>
              <p className="text-xs text-muted-foreground">Push events to external URLs</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>

        <Link
          href="/dashboard/integrations/weighbridge"
          className="group flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500/10">
              <Scale className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="font-medium text-foreground">Weighbridge</p>
              <p className="text-xs text-muted-foreground">Two-pass ticket monitor</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>

        <Link
          href="/dashboard/integrations/coffee-coop"
          className="group flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10">
              <Coffee className="h-4 w-4 text-green-700 dark:text-green-400" />
            </div>
            <div>
              <p className="font-medium text-foreground">Coffee Collection</p>
              <p className="text-xs text-muted-foreground">Farmer intake monitor</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>

        <Link
          href="/dashboard/integrations/logs"
          className="group flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10">
              <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="font-medium text-foreground">Sync Logs</p>
              <p className="text-xs text-muted-foreground">
                {stats.logs.processed} processed
                {stats.logs.failed > 0 && ` · ${stats.logs.failed} failed`}
              </p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>
      </div>

      {/* Recent activity */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Recent Activity</h2>
          <Link href="/dashboard/integrations/logs" className="text-xs text-primary hover:underline">
            View all →
          </Link>
        </div>

        {logs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
            <Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No sync activity yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Activity appears here once external systems start sending requests.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card shadow-sm divide-y divide-border">
            {logs.map((log) => (
              <div key={log._id} className="flex items-center gap-3 p-3 sm:p-4">
                {/* Direction indicator */}
                <div className={`hidden sm:flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  log.direction === "inbound"
                    ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                    : "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                }`}>
                  {log.direction === "inbound" ? "IN" : "OUT"}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{log.event}</p>
                    <StatusBadge status={log.status} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {log.connectorType && (
                      <span>{CONNECTOR_LABELS[log.connectorType] ?? log.connectorType}</span>
                    )}
                    {log.externalRef && <span className="font-mono truncate max-w-30">{log.externalRef}</span>}
                    {log.internalRef && <span className="text-primary">{log.internalRef}</span>}
                    {log.error && <span className="text-red-600 dark:text-red-400 truncate max-w-50">{log.error}</span>}
                  </div>
                </div>

                {/* Time */}
                <p className="shrink-0 text-xs text-muted-foreground">{formatRelative(log.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

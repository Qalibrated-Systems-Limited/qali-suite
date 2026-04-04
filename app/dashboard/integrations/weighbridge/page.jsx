import Link from "next/link";
import { ChevronLeft, Scale, CheckCircle2, Clock, TrendingUp, AlertTriangle } from "lucide-react";
import { auth } from "@/auth";
import { getWeighbridgeTickets, getWeighbridgeStats } from "@/app/mongodb/actions/integration-actions";
import { VoidTicketButton } from "./components/VoidTicketButton";

export const metadata = { title: "Weighbridge | Integrations" };

const STATUS_STYLES = {
  completed:      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  first_recorded: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  pending:        "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  voided:         "bg-muted text-muted-foreground",
};

const STATUS_LABELS = {
  completed:      "Completed",
  first_recorded: "Awaiting 2nd Weight",
  pending:        "Pending",
  voided:         "Voided",
};

// Each transaction type gets its own colour so the accountant can scan the list at a glance
const TX_STYLES = {
  purchase:           "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  sale:               "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  sale_standalone:    "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  transfer_out:       "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  transfer_in:        "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  return_to_supplier: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  customer_return:    "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

const TX_LABELS = {
  purchase:           "Purchase",
  sale:               "Sale",
  sale_standalone:    "Sale (No Invoice)",
  transfer_out:       "Transfer Out",
  transfer_in:        "Transfer In",
  return_to_supplier: "Return → Supplier",
  customer_return:    "Customer Return",
};

function formatWeight(weight, unit) {
  if (weight == null) return "—";
  return `${weight.toLocaleString()} ${unit}`;
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleString("en-KE", {
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function TxBadge({ type }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TX_STYLES[type] ?? "bg-muted text-muted-foreground"}`}>
      {TX_LABELS[type] ?? type}
    </span>
  );
}

// GR/IR matching status for purchase tickets
function GrirBadge({ ticket }) {
  if (ticket.transactionType !== "purchase" || ticket.status !== "completed") return null;
  if (ticket.billRef) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> {ticket.billRef}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
      <Clock className="h-3 w-3" /> GR/IR open
    </span>
  );
}

// Transfer leg matching status
function TransferBadge({ ticket }) {
  if (!["transfer_out", "transfer_in"].includes(ticket.transactionType)) return null;
  if (ticket.transferCleared) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Transfer matched
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
      <Clock className="h-3 w-3" /> Transit open
    </span>
  );
}

function StatCard({ label, value, icon: Icon, color = "text-foreground", sub }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function WeighbridgePage() {
  const [{ user }, tickets, stats] = await Promise.all([
    auth(),
    getWeighbridgeTickets({ limit: 100 }),
    getWeighbridgeStats(),
  ]);

  const canVoid     = user?.role === "Admin" || user?.role === "SuperAdmin";
  const totalTonnes = (stats.totalNetKg / 1000).toFixed(2);

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-6xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/integrations" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Integrations
        </Link>
        <span>/</span>
        <span className="text-foreground">Weighbridge</span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Weighbridge Tickets</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Two-pass weighing records from gate software. Completed tickets auto-create stock movements and GL entries.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Tickets" value={stats.total} icon={Scale} />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          color="text-emerald-600 dark:text-emerald-400"
        />
        <StatCard
          label="Awaiting 2nd Pass"
          value={stats.pending}
          icon={Clock}
          color={stats.pending > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}
        />
        <StatCard
          label="Net Weight"
          value={`${totalTonnes}t`}
          icon={TrendingUp}
          sub="completed tickets"
        />
      </div>

      {/* API reference */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground text-sm">Gate software API endpoint</p>
        <p>Send weight readings to:</p>
        <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{`POST /api/v1/weighbridge/tickets
Authorization: Bearer YOUR_WEIGHBRIDGE_KEY

// Pass 1 — first weight (truck on arrival)
{
  "event":           "weighbridge.first_weight",
  "ticketRef":       "WB-001",        // unique ID per trip from gate software
  "transactionType": "purchase",      // REQUIRED — see transaction types below
  "direction":       "inbound",       // informational only
  "weight":          5200,            // kg
  "vehicleReg":      "KBZ 123A",
  "productCode":     "COFFEE-AA",     // matches product SKU
  "partyName":       "Kamau Suppliers",

  // sale only:
  "invoiceRef":      "INV-000123",

  // transfer_out / transfer_in only (same value on both legs):
  "transferRef":     "TR-2026-001"
}

// Pass 2 — second weight (truck on departure) → completes ticket
{
  "event":     "weighbridge.second_weight",
  "ticketRef": "WB-001",
  "weight":    1800
}

// ── transactionType values ───────────────────────────────────────
//
//   purchase           Inbound from supplier
//                        GL: DR Inventory / CR GR/IR
//                        Clears via bill: DR GR/IR / CR Accounts Payable
//
//   sale               Outbound to customer (against invoice)
//                        GL: DR COGS / CR Inventory
//                        Invoice posts revenue only: DR AR / CR Revenue
//
//   sale_standalone    Outbound to customer (no invoice)
//                        GL: DR Stock Variance / CR Inventory
//
//   transfer_out       Outbound to own location
//                        GL: DR Goods in Transit / CR Inventory
//                        Send same transferRef on inbound leg to clear transit
//
//   transfer_in        Inbound from own location
//                        GL: DR Inventory / CR Goods in Transit
//                        Connector auto-links to matching transfer_out ticket
//
//   return_to_supplier Outbound back to supplier
//                        GL: DR GR/IR / CR Inventory
//
//   customer_return    Inbound goods returned by customer
//                        GL: DR Inventory / CR Sales Returns`}</pre>
      </div>

      {/* Tickets table */}
      {tickets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Scale className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No weighbridge tickets yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tickets appear here once your gate software starts sending weight readings.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Ticket</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">1st Weight</th>
                  <th className="px-4 py-3">2nd Weight</th>
                  <th className="px-4 py-3">Net</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Time</th>
                  {canVoid && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tickets.map((t) => (
                  <tr key={t._id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-foreground">{t.ticketNumber}</p>
                        {t.warnings?.length > 0 && (
                          <span title={t.warnings.join("\n")}>
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          </span>
                        )}
                      </div>
                      {t.internalRef && (
                        <p className="text-xs text-primary">{t.internalRef}</p>
                      )}
                      {t.externalRef && (
                        <p className="font-mono text-xs text-muted-foreground">{t.externalRef}</p>
                      )}
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        <GrirBadge ticket={t} />
                        <TransferBadge ticket={t} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <TxBadge type={t.transactionType} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t.vehicleReg || "—"}
                      {t.driverName && <p className="text-xs">{t.driverName}</p>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.productName || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{formatWeight(t.firstWeight, t.weightUnit)}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{formatWeight(t.secondWeight, t.weightUnit)}</td>
                    <td className="px-4 py-3 font-medium tabular-nums">
                      {t.netWeight != null
                        ? <span className="text-foreground">{formatWeight(t.netWeight, t.weightUnit)}</span>
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? "bg-muted text-muted-foreground"}`}>
                        {STATUS_LABELS[t.status] ?? t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(t.createdAt)}
                    </td>
                    {canVoid && (
                      <td className="px-4 py-3">
                        {t.status !== "voided" && (
                          <VoidTicketButton
                            ticketId={t._id}
                            ticketNumber={t.ticketNumber}
                            status={t.status}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="divide-y divide-border md:hidden">
            {tickets.map((t) => (
              <div key={t._id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground">{t.ticketNumber}</p>
                      <TxBadge type={t.transactionType} />
                      {t.warnings?.length > 0 && (
                        <span title={t.warnings.join("\n")}>
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                      )}
                    </div>
                    {t.vehicleReg && <p className="mt-0.5 text-xs text-muted-foreground">{t.vehicleReg}</p>}
                    {t.productName && <p className="text-xs text-muted-foreground">{t.productName}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? "bg-muted text-muted-foreground"}`}>
                      {STATUS_LABELS[t.status] ?? t.status}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatTime(t.createdAt)}</span>
                  </div>
                </div>

                {/* Weights */}
                <div className="mt-2 grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-2 text-xs tabular-nums">
                  <div className="text-center">
                    <p className="text-muted-foreground">1st</p>
                    <p className="font-medium text-foreground">{formatWeight(t.firstWeight, t.weightUnit)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground">2nd</p>
                    <p className="font-medium text-foreground">{formatWeight(t.secondWeight, t.weightUnit)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground">Net</p>
                    <p className="font-medium text-emerald-600 dark:text-emerald-400">{formatWeight(t.netWeight, t.weightUnit)}</p>
                  </div>
                </div>

                {t.internalRef && <p className="mt-1 text-xs text-primary">{t.internalRef}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <GrirBadge ticket={t} />
                  <TransferBadge ticket={t} />
                  {canVoid && t.status !== "voided" && (
                    <VoidTicketButton
                      ticketId={t._id}
                      ticketNumber={t.ticketNumber}
                      status={t.status}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

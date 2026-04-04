import Link from "next/link";
import {
  ChevronLeft,
  Coffee,
  CheckCircle2,
  Clock,
  Users,
  TrendingUp,
  AlertTriangle,
  Leaf,
} from "lucide-react";
import { getCoffeeIntakes, getCoffeeCoopStats, getCoffeeSeasons } from "@/app/mongodb/actions/coffee-coop-actions";

export const metadata = { title: "Coffee Collection | Integrations" };

// ── Constants ─────────────────────────────────────────────

const GRADE_STYLES = {
  AA:       "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  AB:       "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  C:        "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  PB:       "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  E:        "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  TT:       "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  UG:       "bg-muted text-muted-foreground",
  ungraded: "bg-muted text-muted-foreground",
};

const COFFEE_TYPE_LABELS = {
  cherry:    "Cherry",
  parchment: "Parchment",
  mbuni:     "Mbuni",
};

const PAYMENT_STATUS_STYLES = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  partial: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  paid:    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

// ── Helpers ───────────────────────────────────────────────

function formatKg(kg) {
  if (kg == null) return "—";
  if (kg >= 1000) return `${(kg / 1000).toFixed(2)} t`;
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

function formatKES(amount) {
  if (amount == null) return "—";
  return `KES ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleString("en-KE", {
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Components ────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, color = "text-foreground" }) {
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

function GradeBadge({ grade }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${GRADE_STYLES[grade] ?? "bg-muted text-muted-foreground"}`}>
      {grade}
    </span>
  );
}

function PaymentBadge({ status }) {
  const labels = { pending: "Unpaid", partial: "Partial", paid: "Paid" };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"}`}>
      {labels[status] ?? status}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────

export default async function CoffeeCoopPage() {
  const [intakes, stats, seasons] = await Promise.all([
    getCoffeeIntakes({ limit: 100 }),
    getCoffeeCoopStats(),
    getCoffeeSeasons(),
  ]);

  const activeSeason = seasons.find((s) => s.isActive) ?? null;

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-6xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/integrations" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Integrations
        </Link>
        <span>/</span>
        <span className="text-foreground">Coffee Collection</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Coffee Collection Centre</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Farmer intake records from the collection station.
            {activeSeason && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <Leaf className="h-3 w-3" /> {activeSeason.name}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total Intakes"
          value={stats.totalEntries.toLocaleString()}
          sub={activeSeason ? activeSeason.name : "all seasons"}
          icon={Coffee}
        />
        <StatCard
          label="Net Weight"
          value={formatKg(stats.totalNetKg)}
          sub="gross − deductions"
          icon={TrendingUp}
          color="text-emerald-600 dark:text-emerald-400"
        />
        <StatCard
          label="Farmers Served"
          value={stats.uniqueFarmers.toLocaleString()}
          sub="unique members"
          icon={Users}
        />
        <StatCard
          label="Pending Payments"
          value={stats.pendingPayments.toLocaleString()}
          sub={stats.pendingAmount > 0 ? formatKES(stats.pendingAmount) : undefined}
          icon={Clock}
          color={stats.pendingPayments > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}
        />
      </div>

      {/* API Reference */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground text-sm">Intake station API endpoint</p>
        <p>Send farmer deliveries to:</p>
        <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{`POST /api/v1/coffee-coop/intake
Authorization: Bearer YOUR_COFFEE_COOP_KEY

{
  "event":           "collection.intake_created",
  "externalRef":     "IC-2026-001",      // station's unique ID (idempotency)
  "farmerCode":      "M-0042",           // REQUIRED — member number
  "farmerName":      "Jane Wanjiku",
  "coffeeType":      "parchment",        // cherry | parchment | mbuni  (REQUIRED)
  "grade":           "AA",              // AA | AB | C | PB | E | TT | UG  (REQUIRED)
  "grossWeight":     52.4,              // kg as weighed  (REQUIRED)
  "deductionWeight": 2.4,               // tare/moisture deduction (default: 0)
  "moisture":        12,                // % moisture content (informational)
  "unitPrice":       85,                // KES/kg net — resolved from season priceSchedule if omitted
  "productCode":     "COFFEE-AA",       // matches product SKU — enables stock movement
  "seasonRef":       "2024/25 Long Rains", // name or _id — defaults to active season
  "paymentMethod":   "member_account",  // cash | member_account | mpesa | bank_transfer
  "notes":           "Good quality"
}

// ── GL posted on intake ───────────────────────────────────
//   DR Inventory        (coffee stock increases by netWeight)
//   CR Farmer Payable   (liability to farmer for totalAmount)
//
// ── Coffee grades ─────────────────────────────────────────
//   AA   Premium large beans
//   AB   Standard mixed size
//   C    Commercial grade
//   PB   Peaberry (round beans)
//   E    Elephant bean (very large)
//   TT   Light / triage beans
//   UG   Ungraded`}</pre>
      </div>

      {/* Season info */}
      {seasons.length > 0 && (
        <div>
          <h2 className="mb-3 font-semibold text-foreground">Seasons</h2>
          <div className="flex flex-wrap gap-2">
            {seasons.map((s) => (
              <div
                key={s._id}
                className={`rounded-lg border px-4 py-2 text-sm ${
                  s.isActive
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-border bg-card"
                }`}
              >
                <p className="font-medium text-foreground">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.year}
                  {s.isActive && (
                    <span className="ml-1.5 font-medium text-emerald-600 dark:text-emerald-400">● Active</span>
                  )}
                </p>
                {s.priceSchedule?.length > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {s.priceSchedule.length} price{s.priceSchedule.length !== 1 ? "s" : ""} set
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Intake table */}
      {intakes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Coffee className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No intake records yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Records appear here once your intake station starts sending deliveries.
          </p>
          {!activeSeason && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
              No active season — create a season first so intakes can be associated.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card shadow-sm">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Entry</th>
                  <th className="px-4 py-3">Farmer</th>
                  <th className="px-4 py-3">Grade</th>
                  <th className="px-4 py-3">Gross</th>
                  <th className="px-4 py-3">Net</th>
                  <th className="px-4 py-3">Unit Price</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {intakes.map((e) => (
                  <tr key={e._id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-foreground">{e.entryNumber}</p>
                        {e.warnings?.length > 0 && (
                          <span title={e.warnings.join("\n")}>
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          </span>
                        )}
                      </div>
                      {e.journalEntryNumber && (
                        <p className="text-xs text-primary">{e.journalEntryNumber}</p>
                      )}
                      {e.externalRef && (
                        <p className="font-mono text-xs text-muted-foreground">{e.externalRef}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{e.farmerName || e.farmerCode}</p>
                      {e.farmerName && (
                        <p className="text-xs text-muted-foreground font-mono">{e.farmerCode}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <GradeBadge grade={e.grade} />
                      <p className="mt-0.5 text-xs text-muted-foreground capitalize">
                        {COFFEE_TYPE_LABELS[e.coffeeType] ?? e.coffeeType}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {e.grossWeight != null ? `${e.grossWeight} kg` : "—"}
                      {e.deductionWeight > 0 && (
                        <p className="text-xs text-muted-foreground">−{e.deductionWeight} kg</p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums text-foreground">
                      {e.netWeight != null ? `${e.netWeight} kg` : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {e.unitPrice > 0 ? `${e.currency} ${e.unitPrice}/kg` : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums text-foreground">
                      {e.totalAmount > 0 ? formatKES(e.totalAmount) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <PaymentBadge status={e.paymentStatus} />
                      <p className="mt-0.5 text-xs text-muted-foreground capitalize">
                        {e.paymentMethod?.replace("_", " ")}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(e.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="divide-y divide-border md:hidden">
            {intakes.map((e) => (
              <div key={e._id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground">{e.entryNumber}</p>
                      <GradeBadge grade={e.grade} />
                      {e.warnings?.length > 0 && (
                        <span title={e.warnings.join("\n")}>
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-foreground">
                      {e.farmerName || e.farmerCode}
                    </p>
                    {e.farmerName && (
                      <p className="text-xs text-muted-foreground font-mono">{e.farmerCode}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <PaymentBadge status={e.paymentStatus} />
                    <span className="text-xs text-muted-foreground">{formatTime(e.createdAt)}</span>
                  </div>
                </div>

                {/* Weights & amount */}
                <div className="mt-2 grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-2 text-xs tabular-nums">
                  <div className="text-center">
                    <p className="text-muted-foreground">Gross</p>
                    <p className="font-medium text-foreground">{e.grossWeight} kg</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground">Net</p>
                    <p className="font-medium text-emerald-600 dark:text-emerald-400">{e.netWeight} kg</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground">Amount</p>
                    <p className="font-medium text-foreground">
                      {e.totalAmount > 0 ? formatKES(e.totalAmount) : "—"}
                    </p>
                  </div>
                </div>

                {e.journalEntryNumber && (
                  <p className="mt-1 text-xs text-primary">{e.journalEntryNumber}</p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground capitalize">
                  {COFFEE_TYPE_LABELS[e.coffeeType] ?? e.coffeeType}
                  {e.unitPrice > 0 && ` · ${e.currency} ${e.unitPrice}/kg`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

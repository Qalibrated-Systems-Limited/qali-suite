import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  CheckSquare,
  CheckCircle2,
  XCircle,
  Clock,
  Tag,
  Receipt,
  Package,
  Percent,
  AlertTriangle,
  ChevronLeft,
} from "lucide-react";

import { canSeeApprovalsNav } from "@/lib/permissions";
import { cApprovalQueue, cMySubmittedApprovals } from "@/app/mongodb/queries/approval-queries";
import { getPendingApprovalRequests } from "@/app/mongodb/queries/request-queries";
import {
  getPendingBills,
  getPendingLeaveRequests,
  getPendingLoans,
  getPendingReimbursements,
  getPendingAdvances,
  getPendingNCRs,
  getPendingOperatingExpenses,
} from "@/app/mongodb/queries/pending-approvals-queries";
import { Banknote, CalendarDays, Coins, HandCoins, FileWarning, Wallet } from "lucide-react";
import ApprovalDecisionForm from "./components/ApprovalDecisionForm";

// Per-domain approver allowlists imported from the central rules
// module. Don't redefine them here — change @/lib/business-rules and
// every consumer (this page, approval-queries, dashboard tile) picks it
// up at once.
import {
  STOCK_REQUEST_APPROVER_ROLES,
  BILL_APPROVER_ROLES,
  LEAVE_APPROVER_ROLES,
  LOAN_APPROVER_ROLES,
  CLAIM_APPROVER_ROLES,
  NCR_AUTHORIZER_ROLES,
  OPERATING_EXPENSE_APPROVER_ROLES,
} from "@/lib/business-rules";

const PRIORITY_STYLES: Record<string, string> = {
  urgent:
    "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
  high:
    "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-400",
  normal:
    "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400",
  low:
    "bg-muted text-muted-foreground ring-border",
};

export const metadata = { title: "Approvals | ERP System" };

const TYPE_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  price_change: { label: "Price change", icon: Tag },
  stock_writeoff: { label: "Stock write-off", icon: Package },
  stock_adjustment: { label: "Stock adjustment", icon: Package },
  bill_payment: { label: "Bill payment", icon: Receipt },
  credit_note: { label: "Credit note", icon: Receipt },
  discount: { label: "Discount", icon: Percent },
};

const STATUS_STYLES: Record<string, { className: string; label: string; icon: React.ComponentType<{ className?: string }> }> = {
  submitted: {
    className: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
    label: "Submitted",
    icon: Clock,
  },
  approved: {
    className: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
    label: "Approved",
    icon: CheckCircle2,
  },
  rejected: {
    className: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
    label: "Rejected",
    icon: XCircle,
  },
  cancelled: {
    className: "bg-muted text-muted-foreground ring-border",
    label: "Cancelled",
    icon: XCircle,
  },
};

function formatRelative(d?: string | Date | null) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(amount?: number | null) {
  return (Number(amount) || 0).toLocaleString("en-KE", {
    maximumFractionDigits: 0,
  });
}

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_STYLES[status] || STATUS_STYLES.submitted;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cfg.className}`}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function TypePill({ type }: { type: string }) {
  const meta = TYPE_META[type] || { label: type, icon: AlertTriangle };
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

// ============================================
// PRICE-CHANGE SPECIFIC RENDER
// ============================================
function PriceChangeContext({
  payload,
  context,
}: {
  payload: any;
  context: any;
}) {
  const cost = Number(context?.cost) || 0;
  const previous = Number(context?.previousPrice) || 0;
  const next =
    payload?.priceMode === "markup"
      ? cost > 0
        ? Math.round(cost * (1 + (Number(payload.markupPercent) || 0) / 100) * 100) / 100
        : 0
      : Number(payload?.sellingPrice) || 0;
  const delta = next - previous;
  const pct = previous > 0 ? (delta / previous) * 100 : 0;
  const newMargin = next > 0 ? ((next - cost) / next) * 100 : 0;
  return (
    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div>
        <p className="text-muted-foreground">Cost</p>
        <p className="font-semibold tabular-nums">KES {formatCurrency(cost)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Was</p>
        <p className="font-semibold tabular-nums">
          KES {formatCurrency(previous)}
        </p>
      </div>
      <div>
        <p className="text-muted-foreground">Proposed</p>
        <p
          className={`font-semibold tabular-nums ${
            delta < 0
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          KES {formatCurrency(next)}
        </p>
        {previous > 0 && (
          <p
            className={`text-[10px] tabular-nums ${
              delta < 0
                ? "text-red-600 dark:text-red-400"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {delta < 0 ? "" : "+"}
            {pct.toFixed(1)}%
          </p>
        )}
      </div>
      <div>
        <p className="text-muted-foreground">New margin</p>
        <p
          className={`font-semibold tabular-nums ${
            newMargin < 0
              ? "text-red-600 dark:text-red-400"
              : newMargin < 8
                ? "text-amber-600 dark:text-amber-400"
                : ""
          }`}
        >
          {newMargin.toFixed(1)}%
        </p>
      </div>
    </div>
  );
}

function StockAdjustmentContext({ context }: { context: any }) {
  const total = Number(context?.totalValue) || 0;
  const lines = Number(context?.lineCount) || 0;
  const type = context?.adjustmentType || "—";
  const threshold = Number(context?.threshold) || 0;
  const overThreshold = total > threshold;
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground">Type</p>
          <p className="font-semibold capitalize">{type.replace("_", " ")}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Lines</p>
          <p className="font-semibold tabular-nums">{lines}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Total value</p>
          <p
            className={`font-semibold tabular-nums ${
              overThreshold
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground"
            }`}
          >
            KES {formatCurrency(total)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Auto threshold</p>
          <p className="font-semibold tabular-nums text-muted-foreground">
            KES {formatCurrency(threshold)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================
// APPROVAL ROW
// ============================================
function ApprovalRow({
  approval,
  canDecide,
}: {
  approval: any;
  canDecide: boolean;
}) {
  return (
    <li className="space-y-3 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-xs text-muted-foreground">
              {approval.requestNumber}
            </p>
            <TypePill type={approval.type} />
            <StatusPill status={approval.status} />
          </div>
          <p className="mt-1 truncate text-sm font-medium">
            {approval.targetRef?.label || "—"}
          </p>
          {approval.reason && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="font-medium">Reason: </span>
              {approval.reason}
            </p>
          )}
          {approval.requesterNote && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="font-medium">Note: </span>"
              {approval.requesterNote}"
            </p>
          )}
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          <p>{approval.submittedBy.name}</p>
          <p className="text-muted-foreground/80">
            {formatRelative(approval.submittedBy.submittedAt)}
          </p>
        </div>
      </div>

      {/* Type-specific context */}
      {approval.type === "price_change" && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <PriceChangeContext
            payload={approval.payload}
            context={approval.context}
          />
        </div>
      )}
      {(approval.type === "stock_adjustment" ||
        approval.type === "stock_writeoff") && (
        <StockAdjustmentContext context={approval.context} />
      )}

      {/* Decision panel */}
      {approval.status === "submitted" && canDecide && (
        <ApprovalDecisionForm approvalId={approval._id} />
      )}

      {/* Already-decided summary */}
      {approval.decision && approval.status !== "submitted" && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <span className="font-medium">
            {approval.status === "approved"
              ? "Approved"
              : approval.status === "rejected"
                ? "Rejected"
                : "Cancelled"}
            {" "}by {approval.decision.by?.name || "—"}
          </span>
          {approval.decision.at && (
            <span className="text-muted-foreground">
              {" "}
              · {formatRelative(approval.decision.at)}
            </span>
          )}
          {approval.decision.note && (
            <p className="mt-0.5 text-muted-foreground">
              "{approval.decision.note}"
            </p>
          )}
        </div>
      )}

      {/* Deep link to source */}
      {approval.targetRef?.kind === "Product" && approval.targetRef?.id && (
        <Link
          href={`/dashboard/stocks/${approval.targetRef.id}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View product
        </Link>
      )}
      {approval.targetRef?.kind === "InventoryAdjustment" &&
        approval.targetRef?.id && (
          <Link
            href={`/dashboard/adjustments/${approval.targetRef.id}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View adjustment
          </Link>
        )}
    </li>
  );
}

// ============================================
// ASYNC SECTIONS
// ============================================
async function PendingQueue({ canDecide }: { canDecide: boolean }) {
  const rows = await cApprovalQueue("submitted");

  // Render nothing when this domain has nothing — other domain
  // sections render below independently and may have items. A page-
  // level "Nothing pending" card is rendered separately at the page
  // root after ALL sections resolve to empty.
  if (rows.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CheckSquare className="h-4 w-4 text-muted-foreground" />
          Pending decisions
        </h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} item{rows.length === 1 ? "" : "s"}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {rows.map((r: any) => (
          <ApprovalRow key={r._id} approval={r} canDecide={canDecide} />
        ))}
      </ul>
    </section>
  );
}

// ============================================
// PENDING STOCK REQUESTS (cross-flow inbox)
// ============================================
// Surfaces stock requests waiting on approver decisions. Lives outside
// the generic ApprovalRequest engine so we have to query it separately,
// but to the user it's part of the same "things I need to decide on"
// view.
async function PendingStockRequests({ role }: { role: string }) {
  if (!STOCK_REQUEST_APPROVER_ROLES.has(role)) return null;

  const rows = await getPendingApprovalRequests(50);
  if (rows.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Package className="h-4 w-4 text-muted-foreground" />
          Pending stock requests
        </h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} item{rows.length === 1 ? "" : "s"}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {rows.map((r: any) => {
          const priority = r.priority || "normal";
          const priorityClass =
            PRIORITY_STYLES[priority] || PRIORITY_STYLES.normal;
          const itemCount = r.items?.length || 0;
          const totalValue = Number(r.totalValue) || 0;
          return (
            <li key={r._id}>
              <Link
                href={`/dashboard/requests/${r._id}`}
                className="block px-4 py-3 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {r.requestNumber}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${priorityClass}`}
                      >
                        {priority}
                      </span>
                      {r.requestType && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                          {r.requestType.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm font-medium">
                      {r.requester?.name || "—"}
                      {r.requester?.department && (
                        <span className="text-muted-foreground">
                          {" "}· {r.requester.department}
                        </span>
                      )}
                    </p>
                    {r.customer?.name && (
                      <p className="truncate text-xs text-muted-foreground">
                        Customer: {r.customer.name}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    <p className="font-semibold text-foreground tabular-nums">
                      KES {formatCurrency(totalValue)}
                    </p>
                    <p>
                      {itemCount} item{itemCount === 1 ? "" : "s"}
                    </p>
                    <p className="text-muted-foreground/80">
                      {formatRelative(r.createdAt)}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ============================================
// SHARED ROW + SECTION RENDERERS
// ============================================
// Every cross-domain pending row has the same shape (per
// pending-approvals-queries normalisation), so one helper renders all
// of them. Kept narrow on purpose — sections with bespoke fields
// (stock requests, generic engine) still get their own.
function PendingRow({ row, accent }: { row: any; accent?: string }) {
  return (
    <li>
      <Link
        href={row.href}
        className="block px-4 py-3 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {row.ref}
              </span>
              {row.subtitle && (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                  {row.subtitle.replace(/_/g, " ")}
                </span>
              )}
            </div>
            <p className="truncate text-sm font-medium">{row.title}</p>
            {row.meta && (
              <p className="truncate text-xs text-muted-foreground">
                {row.meta}
              </p>
            )}
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            {row.amount > 0 && (
              <p
                className={`font-semibold tabular-nums ${accent || "text-foreground"}`}
              >
                KES {formatCurrency(row.amount)}
              </p>
            )}
            <p>{row.submittedBy}</p>
            <p className="text-muted-foreground/80">
              {formatRelative(row.submittedAt)}
            </p>
          </div>
        </div>
      </Link>
    </li>
  );
}

function PendingSectionShell({
  title,
  Icon,
  rows,
  accent,
}: {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  rows: any[];
  accent?: string;
}) {
  if (!rows || rows.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} item{rows.length === 1 ? "" : "s"}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {rows.map((r: any) => (
          <PendingRow key={r._id} row={r} accent={accent} />
        ))}
      </ul>
    </section>
  );
}

// ============================================
// DOMAIN SECTIONS — one async server component each
// ============================================
async function PendingBills({ role }: { role: string }) {
  if (!BILL_APPROVER_ROLES.has(role)) return null;
  const rows = await getPendingBills(50);
  return (
    <PendingSectionShell
      title="Pending bills"
      Icon={Receipt}
      rows={rows}
      accent="text-foreground"
    />
  );
}

async function PendingLeave({ role }: { role: string }) {
  if (!LEAVE_APPROVER_ROLES.has(role)) return null;
  const rows = await getPendingLeaveRequests(50);
  return (
    <PendingSectionShell
      title="Pending leave requests"
      Icon={CalendarDays}
      rows={rows}
    />
  );
}

async function PendingLoansSection({ role }: { role: string }) {
  if (!LOAN_APPROVER_ROLES.has(role)) return null;
  const rows = await getPendingLoans(50);
  return (
    <PendingSectionShell
      title="Pending loans"
      Icon={Banknote}
      rows={rows}
    />
  );
}

async function PendingAdvances({ role }: { role: string }) {
  if (!CLAIM_APPROVER_ROLES.has(role)) return null;
  const rows = await getPendingAdvances(50);
  return (
    <PendingSectionShell
      title="Pending advance requests"
      Icon={HandCoins}
      rows={rows}
    />
  );
}

async function PendingReimbursements({ role }: { role: string }) {
  if (!CLAIM_APPROVER_ROLES.has(role)) return null;
  const rows = await getPendingReimbursements(50);
  return (
    <PendingSectionShell
      title="Pending reimbursements"
      Icon={Coins}
      rows={rows}
    />
  );
}

async function PendingOperatingExpensesSection({ role }: { role: string }) {
  if (!OPERATING_EXPENSE_APPROVER_ROLES.has(role)) return null;
  const rows = await getPendingOperatingExpenses(50);
  return (
    <PendingSectionShell
      title="Pending operating expenses"
      Icon={Wallet}
      rows={rows}
    />
  );
}

async function PendingNCRsSection({ role }: { role: string }) {
  if (!NCR_AUTHORIZER_ROLES.has(role)) return null;
  const rows = await getPendingNCRs(50);
  return (
    <PendingSectionShell
      title="Pending NCR authorisations"
      Icon={FileWarning}
      rows={rows}
    />
  );
}

async function MySubmissions() {
  const rows = await cMySubmittedApprovals(15);

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          My submissions
        </h2>
        <span className="text-xs text-muted-foreground">
          Last {rows.length}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {rows.map((r: any) => (
          <li key={r._id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {r.requestNumber}
                </span>
                <TypePill type={r.type} />
              </div>
              {r.reason && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {r.reason}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-muted-foreground">
                {formatRelative(r.submittedAt)}
              </span>
              <StatusPill status={r.status} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================
// SKELETONS
// ============================================
function QueueSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-2.5">
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
      </div>
      <ul className="divide-y divide-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="space-y-2 px-4 py-4">
            <div className="h-3 w-40 animate-pulse rounded bg-muted" />
            <div className="h-3 w-64 animate-pulse rounded bg-muted/60" />
            <div className="h-12 animate-pulse rounded bg-muted/30" />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================
// PAGE
// ============================================
export default async function ApprovalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as { role?: string }).role || "Employee";
  const canDecide = canSeeApprovalsNav(role);

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Dashboard
        </Link>
        <span>/</span>
        <span className="text-foreground">Approvals</span>
      </nav>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <CheckSquare className="h-5 w-5 text-muted-foreground" />
          Approvals
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
          {canDecide
            ? "Decide on pending requests routed to your role."
            : "Track the status of approvals you've submitted."}
        </p>
      </header>

      {canDecide && (
        <Suspense fallback={<QueueSkeleton />}>
          <PendingQueue canDecide={canDecide} />
        </Suspense>
      )}

      {/* Cross-domain pending sections. Each streams independently —
          a slow query in one domain won't block the others. Empty
          sections hide entirely; role-gating happens inside each
          component so the query isn't called when the user can't see
          it. */}
      <Suspense fallback={null}>
        <PendingStockRequests role={role} />
      </Suspense>

      <Suspense fallback={null}>
        <PendingBills role={role} />
      </Suspense>

      <Suspense fallback={null}>
        <PendingLeave role={role} />
      </Suspense>

      <Suspense fallback={null}>
        <PendingLoansSection role={role} />
      </Suspense>

      <Suspense fallback={null}>
        <PendingAdvances role={role} />
      </Suspense>

      <Suspense fallback={null}>
        <PendingReimbursements role={role} />
      </Suspense>

      <Suspense fallback={null}>
        <PendingOperatingExpensesSection role={role} />
      </Suspense>

      <Suspense fallback={null}>
        <PendingNCRsSection role={role} />
      </Suspense>

      <Suspense fallback={null}>
        <MySubmissions />
      </Suspense>
    </div>
  );
}

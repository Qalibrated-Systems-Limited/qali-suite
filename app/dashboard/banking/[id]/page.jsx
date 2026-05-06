import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  FileSpreadsheet,
  Clock,
  CheckCircle2,
  Ban,
  Loader2,
  RefreshCw,
  Trash2,
  Scale,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getBankStatementById,
  getBankFeedLines,
  getStatementSummary,
} from "@/app/mongodb/queries/bank-feed-queries";
import { format } from "date-fns";
import BankFeedLinesTable from "./BankFeedLinesTable";
import StatementActions from "./StatementActions";

// ============================================
// METADATA
// ============================================
export async function generateMetadata({ params }) {
  const { id } = await params;
  const statement = await getBankStatementById(id);

  if (!statement) {
    return { title: "Statement Not Found" };
  }

  return {
    title: `${statement.fileName} | Bank Statement`,
    description: `Allocate bank statement transactions`,
  };
}

// ============================================
// PROGRESS CARD
// ============================================
function ProgressCard({ summary }) {
  const progress = summary?.progressPercent || 0;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">Allocation Progress</span>
        <span className="text-2xl font-bold">{progress}%</span>
      </div>
      <div className="h-3 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${
            progress === 100 ? "bg-emerald-500" : "bg-blue-500"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-semibold text-emerald-600">
            {summary?.allocatedLines || 0}
          </p>
          <p className="text-xs text-muted-foreground">Allocated</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-amber-600">
            {summary?.unallocatedLines || 0}
          </p>
          <p className="text-xs text-muted-foreground">Pending</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-gray-500">
            {summary?.excludedLines || 0}
          </p>
          <p className="text-xs text-muted-foreground">Excluded</p>
        </div>
      </div>
    </div>
  );
}

// ============================================
// STATS CARDS
// ============================================
function StatsCards({ statement, summary }) {
  const cards = [
    {
      label: "Total Transactions",
      value: summary?.totalLines || 0,
      icon: FileSpreadsheet,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-500/10",
    },
    {
      label: "Total Money Out",
      value: formatCurrency(summary?.totalDebits || 0),
      icon: Clock,
      iconColor: "text-red-500",
      iconBg: "bg-red-500/10",
    },
    {
      label: "Total Money In",
      value: formatCurrency(summary?.totalCredits || 0),
      icon: CheckCircle2,
      iconColor: "text-emerald-500",
      iconBg: "bg-emerald-500/10",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className={`rounded-md p-2 ${card.iconBg}`}>
              <card.icon className={`h-4 w-4 ${card.iconColor}`} />
            </div>
            <span className="text-lg font-bold">{card.value}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{card.label}</p>
        </div>
      ))}
    </div>
  );
}

// ============================================
// HELPER
// ============================================
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCurrencyExact(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ============================================
// RECONCILIATION CARD
// ============================================
// Shows opening + credits − debits = closing, validated against the
// bank's reported closing balance. The single most trust-building
// signal for bookkeepers reviewing an imported statement: either
// "balanced" (✓) or "drift detected" (⚠) with the exact gap.
function ReconciliationCard({ reconciliation }) {
  if (!reconciliation) return null;
  const r = reconciliation;
  const hasNumbers =
    r.openingBalance != null && r.closingBalance != null;

  if (!hasNumbers) {
    return (
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="h-4 w-4 text-muted-foreground" />
            Statement reconciliation
          </h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <HelpCircle className="h-3 w-3" />
            Not available
          </span>
        </header>
        <div className="p-4 text-sm text-muted-foreground">
          The uploaded file has no running-balance column, so opening and
          closing balances couldn&apos;t be inferred. Net change for the
          period:{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {formatCurrencyExact(r.netChange)}
          </span>
          .
        </div>
      </section>
    );
  }

  const Pill = r.balanced ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400">
      <CheckCircle2 className="h-3 w-3" />
      Balanced
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" />
      Drift detected
    </span>
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Scale className="h-4 w-4 text-muted-foreground" />
          Statement reconciliation
        </h2>
        {Pill}
      </header>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Opening
          </p>
          <p className="mt-0.5 font-semibold tabular-nums">
            {formatCurrencyExact(r.openingBalance)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            + Credits
          </p>
          <p className="mt-0.5 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            +{formatCurrencyExact(r.totalCredits)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            − Debits
          </p>
          <p className="mt-0.5 font-semibold tabular-nums text-red-700 dark:text-red-400">
            −{formatCurrencyExact(r.totalDebits)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Closing (computed)
          </p>
          <p className="mt-0.5 font-semibold tabular-nums">
            {formatCurrencyExact(r.computedClosing)}
          </p>
        </div>
      </div>
      <div className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">
            Bank reported closing
            {r.source === "from_file" ? " (from file)" : ""}:{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {formatCurrencyExact(r.closingBalance)}
            </span>
          </span>
          {!r.balanced && (
            <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              Drift: {formatCurrencyExact(r.drift)}
            </span>
          )}
        </div>
        {!r.balanced && (
          <p className="mt-1 text-muted-foreground">
            Opening + credits − debits doesn&apos;t equal the bank&apos;s
            closing. Likely causes: missed lines during import, wrong
            column mapping for debit/credit, or a duplicate that should
            have been flagged. Reconcile manually before posting.
          </p>
        )}
      </div>
    </section>
  );
}

// ============================================
// LINES LIST WRAPPER
// ============================================
async function LinesListWrapper({ statementId, searchParams }) {
  const params = await searchParams;
  const page = Number(params?.page) || 1;
  const status = params?.status || "";
  const type = params?.type || "";
  const search = params?.search || "";

  const { lines, pagination } = await getBankFeedLines(
    statementId,
    { status, type, search },
    page,
    50
  );

  return (
    <BankFeedLinesTable
      lines={lines}
      pagination={pagination}
      statementId={statementId}
      filters={{ status, type, search }}
    />
  );
}

// ============================================
// PAGE COMPONENT
// ============================================
export default async function StatementDetailPage({ params, searchParams }) {
  const { id } = await params;

  const [statement, summary] = await Promise.all([
    getBankStatementById(id),
    getStatementSummary(id),
  ]);

  if (!statement) {
    notFound();
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Button variant="outline" size="icon" asChild>
            <Link href="/dashboard/banking">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {statement.fileName}
            </h1>
            <p className="text-muted-foreground">
              {statement.bankAccountCode} - {statement.bankAccountName}
            </p>
            {statement.statementPeriod?.startDate && (
              <p className="text-sm text-muted-foreground mt-1">
                Period:{" "}
                {format(new Date(statement.statementPeriod.startDate), "MMM d, yyyy")} -{" "}
                {format(new Date(statement.statementPeriod.endDate), "MMM d, yyyy")}
              </p>
            )}
          </div>
        </div>

        <StatementActions statementId={id} status={statement.status} />
      </div>

      {/* Progress & Stats */}
      <div className="grid gap-4 lg:grid-cols-4">
        <ProgressCard summary={summary} />
        <div className="lg:col-span-3">
          <StatsCards statement={statement} summary={summary} />
        </div>
      </div>

      {/* Lines Table */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <LinesListWrapper statementId={id} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

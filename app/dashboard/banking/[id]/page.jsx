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

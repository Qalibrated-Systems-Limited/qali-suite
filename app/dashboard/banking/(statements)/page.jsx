import { Suspense } from "react";
import Link from "next/link";
import {
  FileSpreadsheet,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Upload,
  ArrowRight,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Pagination from "@/components/pagination";
import {
  getBankStatements,
  getUnallocatedCount,
  getBankAccounts,
} from "@/app/mongodb/queries/bank-feed-queries";
import { auth } from "@/auth";
import { format } from "date-fns";

// ============================================
// METADATA
// ============================================
export const metadata = {
  title: "Banking | Bank Feed",
  description: "Import and allocate bank statements",
};

// ============================================
// STATUS BADGE
// ============================================
function StatusBadge({ status }) {
  const config = {
    processing: {
      label: "Processing",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      icon: Clock,
    },
    ready: {
      label: "Ready",
      className: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
      icon: FileSpreadsheet,
    },
    completed: {
      label: "Completed",
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      icon: CheckCircle2,
    },
    error: {
      label: "Error",
      className: "bg-red-500/15 text-red-700 dark:text-red-400",
      icon: AlertCircle,
    },
  };

  const { label, className, icon: Icon } = config[status] || config.processing;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${className}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ============================================
// PROGRESS BAR
// ============================================
function ProgressBar({ stats }) {
  const total = stats?.totalLines || 0;
  const allocated = stats?.allocatedLines || 0;
  const excluded = stats?.excludedLines || 0;
  const progress = total > 0 ? Math.round(((allocated + excluded) / total) * 100) : 0;

  return (
    <div className="w-24">
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${
            progress === 100 ? "bg-emerald-500" : "bg-blue-500"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-xs text-center mt-1 text-muted-foreground">{progress}%</p>
    </div>
  );
}

// ============================================
// STATS CARDS
// ============================================
async function StatsCards() {
  const [{ pagination }, unallocatedCount, bankAccounts] = await Promise.all([
    getBankStatements(1, 1),
    getUnallocatedCount(),
    getBankAccounts(),
  ]);

  const cards = [
    {
      label: "Total Statements",
      value: pagination.total,
      icon: FileSpreadsheet,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-500/10",
    },
    {
      label: "Unallocated Lines",
      value: unallocatedCount,
      icon: Clock,
      iconColor: unallocatedCount > 0 ? "text-amber-500" : "text-emerald-500",
      iconBg: unallocatedCount > 0 ? "bg-amber-500/10" : "bg-emerald-500/10",
      alert: unallocatedCount > 0,
      href: "/dashboard/banking/unallocated",
    },
    {
      label: "Bank Accounts",
      value: bankAccounts.length,
      icon: Building2,
      iconColor: "text-purple-500",
      iconBg: "bg-purple-500/10",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((card) => {
        const CardWrapper = card.href ? Link : "div";
        const cardProps = card.href ? { href: card.href } : {};

        return (
          <CardWrapper
            key={card.label}
            {...cardProps}
            className={`rounded-lg border bg-card p-4 ${
              card.href ? "hover:bg-muted/50 transition-colors cursor-pointer" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <div className={`rounded-md p-2 ${card.iconBg}`}>
                <card.icon className={`h-4 w-4 ${card.iconColor}`} />
              </div>
              <span className="text-2xl font-bold">{card.value}</span>
            </div>
            <div className="mt-3">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              {card.alert && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Requires attention - Click to view
                </p>
              )}
            </div>
          </CardWrapper>
        );
      })}
    </div>
  );
}

// ============================================
// STATEMENTS TABLE (Desktop)
// ============================================
function StatementsTable({ statements }) {
  if (statements.length === 0) {
    return (
      <div className="hidden md:block rounded-lg border bg-card p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-semibold">No statements yet</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Import your first bank statement to get started.
        </p>
        <Button asChild className="mt-4">
          <Link href="/dashboard/banking/upload">
            <Upload className="h-4 w-4 mr-2" />
            Import Statement
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="hidden md:block rounded-lg border bg-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
              File Name
            </th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
              Bank Account
            </th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
              Period
            </th>
            <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
              Lines
            </th>
            <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
              Status
            </th>
            <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
              Progress
            </th>
            <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {statements.map((statement) => (
            <tr key={statement._id} className="hover:bg-muted/50 transition-colors">
              <td className="px-4 py-3">
                <Link
                  href={`/dashboard/banking/${statement._id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {statement.fileName}
                </Link>
                <p className="text-xs text-muted-foreground">
                  Uploaded {format(new Date(statement.createdAt), "MMM d, yyyy")}
                </p>
              </td>
              <td className="px-4 py-3">
                <span className="font-mono text-xs text-muted-foreground mr-1">
                  {statement.bankAccountCode}
                </span>
                <span>{statement.bankAccountName}</span>
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {statement.statementPeriod?.startDate ? (
                  <>
                    {format(new Date(statement.statementPeriod.startDate), "MMM d")} -{" "}
                    {format(new Date(statement.statementPeriod.endDate), "MMM d, yyyy")}
                  </>
                ) : (
                  "-"
                )}
              </td>
              <td className="px-4 py-3 text-center">
                <div className="text-sm">
                  <span className="font-medium">{statement.stats?.totalLines || 0}</span>
                  {statement.stats?.unallocatedLines > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 ml-1">
                      ({statement.stats.unallocatedLines} pending)
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-center">
                <StatusBadge status={statement.status} />
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-center">
                  <ProgressBar stats={statement.stats} />
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <Button asChild size="sm">
                  <Link href={`/dashboard/banking/${statement._id}`}>
                    {statement.status === "ready" ? "Allocate" : "View"}
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================
// STATEMENTS CARDS (Mobile)
// ============================================
function StatementsCards({ statements }) {
  if (statements.length === 0) {
    return (
      <div className="md:hidden rounded-lg border bg-card p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-semibold">No statements yet</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Import your first bank statement to get started.
        </p>
        <Button asChild className="mt-4">
          <Link href="/dashboard/banking/upload">
            <Upload className="h-4 w-4 mr-2" />
            Import Statement
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="md:hidden space-y-3">
      {statements.map((statement) => (
        <Link
          key={statement._id}
          href={`/dashboard/banking/${statement._id}`}
          className="block rounded-lg border bg-card p-4 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-primary">{statement.fileName}</span>
                <StatusBadge status={statement.status} />
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {statement.bankAccountCode} - {statement.bankAccountName}
              </p>
            </div>
            <ProgressBar stats={statement.stats} />
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t">
            <div className="text-xs text-muted-foreground">
              {statement.stats?.totalLines || 0} lines
              {statement.stats?.unallocatedLines > 0 && (
                <span className="text-amber-600 dark:text-amber-400 ml-1">
                  ({statement.stats.unallocatedLines} pending)
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {format(new Date(statement.createdAt), "MMM d, yyyy")}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ============================================
// STATEMENTS LIST
// ============================================
async function StatementsList({ searchParams }) {
  const params = await searchParams;
  const page = Number(params?.page) || 1;

  const { statements, pagination } = await getBankStatements(page, 10);

  return (
    <>
      <StatementsTable statements={statements} />
      <StatementsCards statements={statements} />

      {pagination.totalPages > 1 && (
        <div className="mt-6">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
          />
        </div>
      )}
    </>
  );
}

// ============================================
// PAGE COMPONENT
// ============================================
export default async function BankingPage({ searchParams }) {
  const session = await auth();
  const canImport = ["SuperAdmin", "Admin", "Accountant"].includes(session?.user?.role);

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bank Feed</h1>
          <p className="text-muted-foreground">
            Import and allocate bank statements
          </p>
        </div>
        {canImport && (
          <Button asChild>
            <Link href="/dashboard/banking/upload">
              <Upload className="h-4 w-4 mr-2" />
              Import Statement
            </Link>
          </Button>
        )}
      </div>

      {/* Stats */}
      <Suspense
        fallback={
          <div className="grid gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-lg border bg-muted animate-pulse" />
            ))}
          </div>
        }
      >
        <StatsCards />
      </Suspense>

      {/* Statements List */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <StatementsList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

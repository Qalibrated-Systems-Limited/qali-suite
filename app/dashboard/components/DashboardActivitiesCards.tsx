import {
  ActivityCard,
  ActivityItem,
  ListItem,
  EmptyState,
  ActivityCardSkeleton,
} from "./ActivityCard";
import {
  getRecentTransactions,
  getDashboardAlerts,
} from "@/app/mongodb/queries/erp-dashboard-queries";
import {
  Receipt,
  FileText,
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Package,
  Users,
  Clock,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";

// ============================================
// RECENT TRANSACTIONS
// ============================================

export async function RecentTransactionsCard() {
  const transactions = await getRecentTransactions(5);

  const getIcon = (type: string) => {
    switch (type) {
      case "sale":
        return <TrendingUp className="w-4 h-4 text-green-600" />;
      case "purchase":
        return <TrendingDown className="w-4 h-4 text-red-600" />;
      case "payment_received":
        return <DollarSign className="w-4 h-4 text-green-600" />;
      case "payment_made":
        return <DollarSign className="w-4 h-4 text-orange-600" />;
      case "expense":
        return <Receipt className="w-4 h-4 text-red-600" />;
      case "advance":
        return <Users className="w-4 h-4 text-blue-600" />;
      default:
        return <FileText className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const formatType = (type: string) => {
    return type
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <ActivityCard
      title="Recent Transactions"
      subtitle="Latest journal entries"
      icon={"Receipt"}
      viewAllHref="/dashboard/journal"
      isEmpty={transactions.length === 0}
      emptyState={
        <EmptyState
          icon={"Receipt"}
          title="No transactions yet"
          description="Journal entries will appear here"
        />
      }
    >
      <div className="space-y-1">
        {transactions.map((txn, index) => (
          <ActivityItem
            key={txn._id}
            icon={getIcon(txn.entryType)}
            title={txn.entryNumber}
            subtitle={txn.description}
            time={formatDate(txn.entryDate)}
            badge={{
              label: formatCurrency(txn.amount),
              variant: "outline",
              className: "text-xs font-mono",
            }}
            href={`/dashboard/journal/${txn._id}`}
            isLast={index === transactions.length - 1}
          />
        ))}
      </div>
    </ActivityCard>
  );
}

// ============================================
// ALERTS CARD
// ============================================
export async function AlertsCard() {
  const alerts = await getDashboardAlerts();

  const alertItems = [
    {
      label: "Overdue Invoices",
      value: alerts.overdueInvoices,
      href: "/dashboard/invoices?status=overdue",
      icon: AlertTriangle,
      show: alerts.overdueInvoices > 0,
    },
    {
      label: "Low Stock Items",
      value: alerts.lowStockCount,
      href: "/dashboard/stocks?quantity=low-stock",
      icon: Package,
      show: alerts.lowStockCount > 0,
    },
    {
      label: "Claims to Pay",
      value: alerts.overdueClaims,
      href: "/dashboard/claims/payments",
      icon: Users,
      show: alerts.overdueClaims > 0,
    },
    {
      label: "Overdue Checkouts",
      value: alerts.overdueCheckouts,
      href: "/dashboard/checkouts?status=overdue",
      icon: Clock,
      show: alerts.overdueCheckouts > 0,
    },
  ].filter((item) => item.show);

  return (
    <ActivityCard
      title="Alerts"
      subtitle={`${alerts.total} items need attention`}
      icon={"AlertTriangle"}
      isEmpty={alertItems.length === 0}
      emptyState={
        <EmptyState
          icon={"AlertTriangle"}
          title="All clear!"
          description="No alerts at the moment"
        />
      }
    >
      <div className="space-y-1">
        {alertItems.map((alert, index) => (
          <ListItem
            key={index}
            title={alert.label}
            value={alert.value}
            badge={{
              label: "Action Required",
              variant: "outline",
              className: "text-xs text-red-600 border-red-600/50",
            }}
            href={alert.href}
          />
        ))}
      </div>
    </ActivityCard>
  );
}

// ============================================
// SKELETONS
// ============================================
export function RecentTransactionsSkeleton() {
  return <ActivityCardSkeleton />;
}

export function AlertsSkeleton() {
  return <ActivityCardSkeleton />;
}

import {
  ActivityCard,
  ActivityItem,
  EmptyState,
  ActivityCardSkeleton,
} from "./ActivityCard";
import { getRecentTransactions } from "@/app/mongodb/queries/erp-dashboard-queries";
import {
  Receipt,
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileText,
  Users,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

// ============================================
// RECENT TRANSACTIONS CARD
// ============================================
export async function RecentTransactionsCard() {
  const transactions = await getRecentTransactions(5);

  // Icon mapping
  const getIcon = (type: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      sale: <TrendingUp className="w-4 h-4 text-green-500" />,
      purchase: <TrendingDown className="w-4 h-4 text-red-500" />,
      payment_received: <DollarSign className="w-4 h-4 text-green-500" />,
      payment_made: <DollarSign className="w-4 h-4 text-orange-500" />,
      expense: <Receipt className="w-4 h-4 text-red-500" />,
      advance: <Users className="w-4 h-4 text-blue-500" />,
    };
    return (
      iconMap[type] || <FileText className="w-4 h-4 text-muted-foreground" />
    );
  };

  // Format date
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
      viewAllHref="/dashboard/journal"
      isEmpty={transactions.length === 0}
      emptyState={
        <EmptyState
          title="No transactions yet"
          description="Journal entries will appear here"
        />
      }
    >
      <div className="space-y-1">
        {transactions.map((txn) => (
          <ActivityItem
            key={txn._id}
            icon={getIcon(txn.entryType)}
            title={txn.entryNumber}
            subtitle={`${txn.description?.substring(0, 40) || ""}${
              txn.description?.length > 40 ? "..." : ""
            } • ${formatDate(txn.entryDate)}`}
            value={formatCurrency(txn.amount)}
            href={`/dashboard/journal/${txn._id}`}
          />
        ))}
      </div>
    </ActivityCard>
  );
}

// Re-export skeleton
export { ActivityCardSkeleton as RecentTransactionsSkeleton };

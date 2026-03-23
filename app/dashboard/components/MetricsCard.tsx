import { Card } from "@/components/ui/card";
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  DollarSign,
  FileText,
  Package,
  TrendingDown,
  TrendingUp,
  Users,
  Clock,
  CheckCircle,
  Wallet,
  Activity,
  ShoppingCart,
  Receipt,
  AlertCircle,
  CheckSquare,
  XSquare,
  ArrowUpRight,
  ArrowDownRight,
  ArrowUpCircle,
  ArrowDownCircle,
  Minus,
  Building2,
  Bell,
  Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

// ============================================
// ICON REGISTRY - PascalCase keys
// ============================================
const icons = {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Banknote,
  Package,
  FileText,
  CreditCard,
  Users,
  AlertTriangle,
  Clock,
  CheckCircle,
  Wallet,
  Activity,
  ShoppingCart,
  Receipt,
  AlertCircle,
  CheckSquare,
  XSquare,
  Building2,
  Bell,
  ArrowUpCircle,
  ArrowDownCircle,
  Scale,
};

export type IconName = keyof typeof icons;

// ============================================
// METRIC CARD COMPONENT
// ============================================
interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: IconName;
  iconColor?: string;
  trend?: number;
  trendLabel?: string;
  alert?: boolean;
  href?: string;
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon,
  iconColor = "text-yellow-500",
  trend,
  trendLabel,
  alert = false,
  href,
}: MetricCardProps) {
  const Icon = icons[icon];

  // Trend indicator
  const TrendIcon =
    trend === undefined
      ? null
      : trend > 0
      ? ArrowUpRight
      : trend < 0
      ? ArrowDownRight
      : Minus;

  const trendColor =
    trend === undefined
      ? ""
      : trend > 0
      ? "text-green-500"
      : trend < 0
      ? "text-red-500"
      : "text-muted-foreground";

  const content = (
    <Card
      className={cn(
        "relative h-full",
        "bg-card border border-border/40",
        "hover:border-border hover:shadow-sm",
        "transition-all duration-200",
        href && "cursor-pointer"
      )}
    >
      <div className="p-3 sm:p-4">
        {/* Header: Label + Icon */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-xs font-medium text-muted-foreground leading-none">
            {title}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {alert && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
              </span>
            )}
            <Icon className={cn("w-3.5 h-3.5", iconColor)} />
          </div>
        </div>

        {/* Value */}
        <p className="text-xl sm:text-2xl font-bold text-foreground tabular-nums tracking-tight leading-none">
          {value}
        </p>

        {/* Footer: Subtitle + Trend */}
        <div className="flex items-center justify-between gap-2 mt-1.5">
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
          {trend !== undefined && TrendIcon && (
            <div className={cn("flex items-center gap-0.5 text-xs font-medium shrink-0", trendColor)}>
              <TrendIcon className="w-3 h-3" />
              <span>{Math.abs(trend).toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {content}
      </Link>
    );
  }

  return content;
}

// ============================================
// METRIC CARD SKELETON
// ============================================
export function MetricCardSkeleton() {
  return (
    <Card className="h-full bg-card border border-border/40">
      <div className="p-3 sm:p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="h-3 w-20 bg-muted animate-pulse rounded" />
          <div className="h-3.5 w-3.5 bg-muted animate-pulse rounded" />
        </div>
        <div className="h-7 w-20 bg-muted animate-pulse rounded mb-1.5" />
        <div className="h-3 w-14 bg-muted animate-pulse rounded" />
      </div>
    </Card>
  );
}

// ============================================
// METRIC CARDS GRID - Consistent sizing
// ============================================
interface MetricCardsGridProps {
  children: React.ReactNode;
  cols?: 2 | 3 | 4 | 5 | 6;
}

export function MetricCardsGrid({ children, cols = 4 }: MetricCardsGridProps) {
  // Responsive grid with consistent card sizing
  const gridClass = cn(
    "grid gap-3 sm:gap-4",
    // Always 2 cols on mobile for consistency
    "grid-cols-2",
    // Tablet and up
    cols === 2 && "sm:grid-cols-2",
    cols === 3 && "sm:grid-cols-3",
    cols === 4 && "sm:grid-cols-2 lg:grid-cols-4",
    cols === 5 && "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
    cols === 6 && "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6"
  );

  return <div className={gridClass}>{children}</div>;
}

export function MetricCardsGridSkeleton({ count = 4 }: { count?: number }) {
  const cols = count <= 4 ? 4 : count <= 5 ? 5 : 6;

  return (
    <MetricCardsGrid cols={cols as 2 | 3 | 4 | 5 | 6}>
      {Array.from({ length: count }).map((_, i) => (
        <MetricCardSkeleton key={i} />
      ))}
    </MetricCardsGrid>
  );
}

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
      {/* Alert indicator */}
      {alert && (
        <div className="absolute top-3 right-3 z-10">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500" />
          </span>
        </div>
      )}

      <div className="p-4 sm:p-5">
        {/* Header: Icon + Title */}
        <div className="flex items-center gap-3 mb-3">
          <div
            className={cn(
              "flex items-center justify-center",
              "w-9 h-9 sm:w-10 sm:h-10 rounded-lg",
              "bg-muted/50"
            )}
          >
            <Icon className={cn("w-4 h-4 sm:w-5 sm:h-5", iconColor)} />
          </div>
          <span className="text-sm font-medium text-muted-foreground truncate">
            {title}
          </span>
        </div>

        {/* Value */}
        <div className="mb-1">
          <p className="text-2xl sm:text-3xl font-bold text-foreground tabular-nums tracking-tight">
            {value}
          </p>
        </div>

        {/* Footer: Subtitle + Trend */}
        <div className="flex items-center justify-between gap-2">
          {subtitle && (
            <p className="text-xs sm:text-sm text-muted-foreground truncate">
              {subtitle}
            </p>
          )}

          {trend !== undefined && TrendIcon && (
            <div
              className={cn(
                "flex items-center gap-0.5 text-xs font-medium",
                trendColor
              )}
            >
              <TrendIcon className="w-3.5 h-3.5" />
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
      <div className="p-4 sm:p-5">
        {/* Header skeleton */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-muted animate-pulse" />
          <div className="h-4 w-20 bg-muted animate-pulse rounded" />
        </div>

        {/* Value skeleton */}
        <div className="mb-1">
          <div className="h-8 sm:h-9 w-24 bg-muted animate-pulse rounded" />
        </div>

        {/* Footer skeleton */}
        <div className="h-4 w-16 bg-muted animate-pulse rounded" />
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

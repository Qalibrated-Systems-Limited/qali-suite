import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

// ============================================
// ACTIVITY CARD COMPONENT
// ============================================
interface ActivityCardProps {
  title: string;
  subtitle?: string;
  viewAllHref?: string;
  children: React.ReactNode;
  className?: string;
  isEmpty?: boolean;
  emptyState?: React.ReactNode;
  icon?: string;
}

export function ActivityCard({
  title,
  subtitle,
  viewAllHref,
  children,
  className,
  isEmpty = false,
  emptyState,
  icon,
}: ActivityCardProps) {
  return (
    <Card
      className={cn(
        "bg-card border border-border/40",
        "hover:border-border transition-colors duration-200",
        className
      )}
    >
      {/* Header */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h3 className="text-sm sm:text-base font-semibold text-foreground">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {viewAllHref && !isEmpty && (
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Link href={viewAllHref}>
                <span className="hidden sm:inline mr-1">View all</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>

      {/* Content */}
      <CardContent className="pt-0">
        {isEmpty && emptyState ? emptyState : children}
      </CardContent>
    </Card>
  );
}

// ============================================
// ACTIVITY LIST ITEM
// ============================================
interface ActivityItemProps {
  title: string;
  subtitle?: string;
  value?: string | number;
  time?: string;
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "outline" | "destructive";
    className?: string;
  };
  href?: string;
  icon?: React.ReactNode;
  isLast?: boolean;
}

export function ActivityItem({
  title,
  subtitle,
  value,
  time,
  badge,
  href,
  icon,
  isLast,
}: ActivityItemProps) {
  const content = (
    <div
      className={cn(
        "flex items-center gap-3 p-3 -mx-3 rounded-lg",
        "transition-colors duration-150",
        href && "hover:bg-muted/50 cursor-pointer"
      )}
    >
      {/* Icon */}
      {icon && (
        <div className="shrink-0 w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
          {icon}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{title}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {subtitle}
          </p>
        )}
      </div>

      {/* Right side: Value + Badge */}
      <div className="shrink-0 flex items-center gap-2">
        {value && (
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {value}
          </span>
        )}
        {badge && (
          <Badge
            variant={badge.variant || "outline"}
            className={cn("text-xs", badge.className)}
          >
            {badge.label}
          </Badge>
        )}
        {href && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

// ============================================
// EMPTY STATE
// ============================================
interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: string;
  action?: {
    label: string;
    href: string;
  };
}

// ============================================
// LIST ITEM - For alerts and simple lists
// ============================================
interface ListItemProps {
  title: string;
  value?: string | number;
  href?: string;
  badge?: {
    label: string;
    variant?: string;
    className?: string;
  };
}

export function ListItem({ title, value, href, badge }: ListItemProps) {
  const content = (
    <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-2">
        <span className="text-sm text-foreground">{title}</span>
        {badge && (
          <span className={`text-xs px-1.5 py-0.5 rounded border ${badge.className || ""}`}>
            {badge.label}
          </span>
        )}
      </div>
      {value !== undefined && (
        <span className="text-sm font-medium text-foreground tabular-nums">{value}</span>
      )}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 px-4">
      <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
        <svg
          className="w-6 h-6 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground mb-4 max-w-50">
          {description}
        </p>
      )}
      {action && (
        <Button
          size="sm"
          asChild
          className="bg-yellow-500 hover:bg-yellow-600 text-black"
        >
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}

// ============================================
// ACTIVITY CARD SKELETON
// ============================================
export function ActivityCardSkeleton() {
  return (
    <Card className="bg-card border border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="h-5 w-32 bg-muted animate-pulse rounded" />
            <div className="h-3 w-24 bg-muted animate-pulse rounded" />
          </div>
          <div className="h-8 w-16 bg-muted animate-pulse rounded" />
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
              <div className="h-3 w-1/2 bg-muted animate-pulse rounded" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

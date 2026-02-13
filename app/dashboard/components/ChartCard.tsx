"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import Link from "next/link";

// ============================================
// CHART CARD COMPONENT
// ============================================
interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
  noPadding?: boolean;
  href?: string;
}

export function ChartCard({
  title,
  subtitle,
  children,
  className,
  action,
  noPadding = false,
  href,
}: ChartCardProps) {
  const card = (
    <Card
      className={cn(
        "bg-card border border-border/40",
        "hover:border-border transition-colors duration-200",
        href && "cursor-pointer hover:shadow-md",
        className
      )}
    >
      {/* Header */}
      <CardHeader className="pb-2 sm:pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm sm:text-base font-semibold text-foreground">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs sm:text-sm text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </CardHeader>

      {/* Content */}
      <CardContent className={cn(!noPadding && "pt-0")}>
        <div className="w-full">{children}</div>
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link href={href}>{card}</Link>;
  }

  return card;
}

// ============================================
// CHART CONTAINER - For Recharts ResponsiveContainer
// ============================================
interface ChartContainerProps {
  children: React.ReactNode;
  height?: number;
  minHeight?: number;
  className?: string;
}

export function ChartContainer({
  children,
  height = 300,
  minHeight = 200,
  className,
}: ChartContainerProps) {
  return (
    <div
      className={cn("w-full", className)}
      style={{ height: `${height}px`, minHeight: `${minHeight}px` }}
    >
      {children}
    </div>
  );
}

// ============================================
// CHART SKELETON
// ============================================
export function ChartCardSkeleton() {
  return (
    <Card className="bg-card border border-border/40">
      <CardHeader className="pb-2 sm:pb-4">
        <div className="space-y-2">
          <div className="h-5 w-32 bg-muted animate-pulse rounded" />
          <div className="h-4 w-48 bg-muted animate-pulse rounded" />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-75 w-full bg-muted/50 animate-pulse rounded-lg flex items-center justify-center">
          <div className="text-muted-foreground text-sm">Loading chart...</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// EMPTY CHART STATE
// ============================================
interface EmptyChartStateProps {
  title?: string;
  description?: string;
  height?: number;
}

export function EmptyChartState({
  title = "No data available",
  description = "Data will appear here once available",
  height = 300,
}: EmptyChartStateProps) {
  return (
    <div
      className="w-full flex flex-col items-center justify-center text-center p-6 rounded-lg bg-muted/20 border border-dashed border-border"
      style={{ height: `${height}px` }}
    >
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
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      <p className="text-xs text-muted-foreground max-w-50">{description}</p>
    </div>
  );
}

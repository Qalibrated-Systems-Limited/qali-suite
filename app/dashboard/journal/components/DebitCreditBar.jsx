"use client";

import { cn } from "@/lib/utils";

export function DebitCreditBar({
  debit,
  credit,
  showAmounts = true,
  showLabels = true,
  size = "md",
  className,
}) {
  const total = Math.max(debit, credit);
  const debitPercent = total > 0 ? (debit / total) * 100 : 0;
  const creditPercent = total > 0 ? (credit / total) * 100 : 0;

  const formatAmount = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const barHeights = {
    sm: "h-1.5",
    md: "h-2",
    lg: "h-3",
  };

  const textSizes = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  return (
    <div className={cn("space-y-1", className)}>
      {/* Debit Row */}
      <div className="flex items-center gap-2">
        {showLabels && (
          <span
            className={cn(
              "w-8 text-muted-foreground font-medium",
              textSizes[size]
            )}
          >
            DR
          </span>
        )}
        <div className="flex-1 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "bg-blue-500 dark:bg-blue-600 rounded-full transition-all duration-300",
              barHeights[size]
            )}
            style={{ width: `${debitPercent}%` }}
          />
        </div>
        {showAmounts && (
          <span
            className={cn(
              "min-w-20 text-right font-mono font-medium tabular-nums",
              textSizes[size]
            )}
          >
            {formatAmount(debit)}
          </span>
        )}
      </div>

      {/* Credit Row */}
      <div className="flex items-center gap-2">
        {showLabels && (
          <span
            className={cn(
              "w-8 text-muted-foreground font-medium",
              textSizes[size]
            )}
          >
            CR
          </span>
        )}
        <div className="flex-1 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "bg-green-500 dark:bg-green-600 rounded-full transition-all duration-300",
              barHeights[size]
            )}
            style={{ width: `${creditPercent}%` }}
          />
        </div>
        {showAmounts && (
          <span
            className={cn(
              "min-w-20 text-right font-mono font-medium tabular-nums",
              textSizes[size]
            )}
          >
            {formatAmount(credit)}
          </span>
        )}
      </div>
    </div>
  );
}

// Compact inline version for mobile
export function DebitCreditInline({
  debit,
  credit,
  className,
}) {
  const formatAmount = (amount) => {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(0)}K`;
    }
    return amount.toFixed(0);
  };

  return (
    <div className={cn("flex items-center gap-3 text-sm", className)}>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        <span className="text-muted-foreground">DR</span>
        <span className="font-mono font-medium">{formatAmount(debit)}</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-muted-foreground">CR</span>
        <span className="font-mono font-medium">{formatAmount(credit)}</span>
      </span>
    </div>
  );
}

// Balance indicator
export function BalanceIndicator({
  debit,
  credit,
  className,
}) {
  const isBalanced = Math.abs(debit - credit) < 0.01;
  const diff = Math.abs(debit - credit);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {isBalanced ? (
        <>
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-xs text-green-600 dark:text-green-400 font-medium">
            Balanced
          </span>
        </>
      ) : (
        <>
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-xs text-red-600 dark:text-red-400 font-medium">
            Off by {diff.toLocaleString()}
          </span>
        </>
      )}
    </div>
  );
}

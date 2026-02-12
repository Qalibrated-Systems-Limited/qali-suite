"use client";

import {
  Receipt,
  ShoppingCart,
  Banknote,
  CreditCard,
  FileText,
  Settings,
  BarChart3,
  User,
  ArrowLeftRight,
  RotateCcw,
  PenLine,
  Package,
  Calculator,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Entry type configuration with icons and colors
export const ENTRY_TYPE_CONFIG = {
  sale: {
    label: "Sale",
    icon: Receipt,
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  purchase: {
    label: "Purchase",
    icon: ShoppingCart,
    color: "text-orange-700 dark:text-orange-400",
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
  },
  payment_received: {
    label: "Payment Received",
    icon: Banknote,
    color: "text-green-700 dark:text-green-400",
    bgColor: "bg-green-100 dark:bg-green-900/30",
  },
  payment_made: {
    label: "Payment Made",
    icon: CreditCard,
    color: "text-red-700 dark:text-red-400",
    bgColor: "bg-red-100 dark:bg-red-900/30",
  },
  expense: {
    label: "Expense",
    icon: FileText,
    color: "text-purple-700 dark:text-purple-400",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
  },
  adjustment: {
    label: "Adjustment",
    icon: Settings,
    color: "text-gray-700 dark:text-gray-400",
    bgColor: "bg-gray-100 dark:bg-gray-800/50",
  },
  opening_balance: {
    label: "Opening Balance",
    icon: BarChart3,
    color: "text-teal-700 dark:text-teal-400",
    bgColor: "bg-teal-100 dark:bg-teal-900/30",
  },
  advance: {
    label: "Advance",
    icon: User,
    color: "text-indigo-700 dark:text-indigo-400",
    bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
  },
  transfer: {
    label: "Transfer",
    icon: ArrowLeftRight,
    color: "text-cyan-700 dark:text-cyan-400",
    bgColor: "bg-cyan-100 dark:bg-cyan-900/30",
  },
  reversal: {
    label: "Reversal",
    icon: RotateCcw,
    color: "text-pink-700 dark:text-pink-400",
    bgColor: "bg-pink-100 dark:bg-pink-900/30",
  },
  manual: {
    label: "Manual Entry",
    icon: PenLine,
    color: "text-slate-700 dark:text-slate-400",
    bgColor: "bg-slate-100 dark:bg-slate-800/50",
  },
  inventory_adjustment: {
    label: "Inventory",
    icon: Package,
    color: "text-amber-700 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  tax: {
    label: "Tax",
    icon: Calculator,
    color: "text-rose-700 dark:text-rose-400",
    bgColor: "bg-rose-100 dark:bg-rose-900/30",
  },
};

// Default config for unknown types
const DEFAULT_CONFIG = {
  label: "Entry",
  icon: FileText,
  color: "text-gray-700 dark:text-gray-400",
  bgColor: "bg-gray-100 dark:bg-gray-800/50",
};

export function EntryTypeBadge({
  type,
  showLabel = true,
  size = "md",
  className,
}) {
  const config = ENTRY_TYPE_CONFIG[type] || {
    ...DEFAULT_CONFIG,
    label: type.replace(/_/g, " "),
  };
  const Icon = config.icon;

  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5 gap-1",
    md: "text-sm px-2 py-1 gap-1.5",
    lg: "text-base px-3 py-1.5 gap-2",
  };

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md font-medium",
        config.bgColor,
        config.color,
        sizeClasses[size],
        className
      )}
    >
      <Icon className={iconSizes[size]} />
      {showLabel && <span className="capitalize">{config.label}</span>}
    </span>
  );
}

// Icon-only version for compact displays
export function EntryTypeIcon({
  type,
  size = "md",
  className,
}) {
  const config = ENTRY_TYPE_CONFIG[type] || DEFAULT_CONFIG;
  const Icon = config.icon;

  const iconSizes = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
  };

  return <Icon className={cn(iconSizes[size], config.color, className)} />;
}

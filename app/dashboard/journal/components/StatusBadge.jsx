"use client";

import { CheckCircle, Clock, RotateCcw, FileEdit } from "lucide-react";
import { cn } from "@/lib/utils";

// Status configuration
const STATUS_CONFIG = {
  draft: {
    label: "Draft",
    icon: FileEdit,
    color: "text-amber-700 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  posted: {
    label: "Posted",
    icon: CheckCircle,
    color: "text-green-700 dark:text-green-400",
    bgColor: "bg-green-100 dark:bg-green-900/30",
  },
  reversed: {
    label: "Reversed",
    icon: RotateCcw,
    color: "text-red-700 dark:text-red-400",
    bgColor: "bg-red-100 dark:bg-red-900/30",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
};

export function StatusBadge({
  status,
  showIcon = true,
  size = "md",
  className,
}) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  const Icon = config.icon;

  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5 gap-1",
    md: "text-sm px-2 py-1 gap-1.5",
    lg: "text-base px-3 py-1.5 gap-2",
  };

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-3.5 h-3.5",
    lg: "w-4 h-4",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium",
        config.bgColor,
        config.color,
        sizeClasses[size],
        status === "reversed" && "line-through decoration-1",
        className
      )}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      <span>{config.label}</span>
    </span>
  );
}

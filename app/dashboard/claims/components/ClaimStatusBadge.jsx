"use client";

import { Badge } from "@/components/ui/badge";

/**
 * Claim Status Badge
 * Visual indicator for claim status with consistent colors
 */
export function ClaimStatusBadge({ status }) {
  const statusConfig = {
    draft: {
      label: "Draft",
      className:
        "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    },
    submitted: {
      label: "Pending Approval",
      className:
        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    },
    approved: {
      label: "Approved",
      className:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    },
    rejected: {
      label: "Rejected",
      className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
    paid: {
      label: "Paid",
      className:
        "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    },
    pending_return: {
      label: "Pending Settlement",
      className:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    },
    pending_payment: {
      label: "Pending Payment",
      className:
        "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
    },
    closed: {
      label: "Closed",
      className:
        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    },
  };

  const config = statusConfig[status] || {
    label: status,
    className: "bg-gray-100 text-gray-700",
  };

  return (
    <Badge variant="secondary" className={`${config.className} font-medium`}>
      {config.label}
    </Badge>
  );
}

/**
 * Claim Type Badge
 * Visual indicator for claim type
 */
export function ClaimTypeBadge({ claimType }) {
  const typeConfig = {
    advance_request: {
      label: "Cash Advance",
      className:
        "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
    },
    reimbursement: {
      label: "Reimbursement",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    advance_return: {
      label: "Advance Settlement",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    },
  };

  const config = typeConfig[claimType] || {
    label: claimType,
    className: "bg-gray-100 text-gray-700",
  };

  return (
    <Badge variant="outline" className={`${config.className} font-medium`}>
      {config.label}
    </Badge>
  );
}

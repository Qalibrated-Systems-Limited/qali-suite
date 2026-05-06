import "server-only";
import Link from "next/link";
import {
  Receipt,
  Package,
  CalendarOff,
  Clock,
} from "lucide-react";
import { cache } from "react";
import mongoose from "mongoose";

import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import EmployeeClaim from "@/app/models/employeesClaims";
import LeaveRequest from "@/app/models/leaveRequest";
import { ItemCheckout } from "@/app/models/checkouts";

// ============================================
// MY ALERTS STRIP — personal counts for the logged-in user
// ============================================
// Shown on EmployeeDashboard so each user sees what's open against THEIR
// account: pending claims, items they've borrowed, upcoming leave, etc.
//
// Cached so siblings on the same dashboard share the result.

const cMyAlerts = cache(async (userId) => {
  if (!userId) {
    return {
      myPendingClaims: 0,
      myCheckedOut: 0,
      myOverdueCheckouts: 0,
      myUpcomingLeave: 0,
    };
  }
  try {
    await dbConnect();
    const { companyId, isSuperAdmin } = await getTenantContext();
    const tenantMatch = isSuperAdmin
      ? {}
      : { companyId: new mongoose.Types.ObjectId(companyId) };

    const now = new Date();
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);

    const [
      myPendingClaims,
      myCheckedOut,
      myOverdueCheckouts,
      myUpcomingLeave,
    ] = await Promise.all([
      EmployeeClaim.countDocuments({
        ...tenantMatch,
        "employee.userId": userId,
        status: { $in: ["submitted", "approved"] },
      }),
      ItemCheckout.countDocuments({
        ...tenantMatch,
        "checkedOutTo.id": userId,
        status: { $in: ["checked_out", "overdue"] },
      }),
      ItemCheckout.countDocuments({
        ...tenantMatch,
        "checkedOutTo.id": userId,
        status: "overdue",
      }),
      LeaveRequest.countDocuments({
        ...tenantMatch,
        "employee.userId": userId,
        status: { $in: ["submitted", "approved"] },
        "dates.from": { $gte: now, $lte: in30 },
      }),
    ]);

    return {
      myPendingClaims,
      myCheckedOut,
      myOverdueCheckouts,
      myUpcomingLeave,
    };
  } catch (error) {
    console.error("cMyAlerts error:", error);
    return {
      myPendingClaims: 0,
      myCheckedOut: 0,
      myOverdueCheckouts: 0,
      myUpcomingLeave: 0,
    };
  }
});

export const MyAlertsStripSkeleton = () => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
    {Array.from({ length: 4 }).map((_, i) => (
      <div
        key={i}
        className="h-16 animate-pulse rounded-lg border border-border bg-muted"
      />
    ))}
  </div>
);

export async function MyAlertsStrip({ userId }) {
  const alerts = await cMyAlerts(userId);

  const tiles = [
    {
      label: "My open claims",
      icon: Receipt,
      href: "/dashboard/my-claims",
      tone: alerts.myPendingClaims > 0 ? "warn" : "neutral",
      value: alerts.myPendingClaims,
    },
    {
      label: "Items I have",
      icon: Package,
      href: "/dashboard/checkout",
      tone: alerts.myOverdueCheckouts > 0 ? "bad" : "neutral",
      value: alerts.myCheckedOut,
    },
    {
      label: "Overdue returns",
      icon: Clock,
      href: "/dashboard/checkout?filter=overdue",
      tone: alerts.myOverdueCheckouts > 0 ? "bad" : "neutral",
      value: alerts.myOverdueCheckouts,
    },
    {
      label: "Upcoming leave",
      icon: CalendarOff,
      href: "/dashboard/hr/my-leave",
      tone: "neutral",
      value: alerts.myUpcomingLeave,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {tiles.map((t) => {
        const Icon = t.icon;
        const toneClass =
          t.tone === "bad"
            ? "border-red-500/30 bg-red-500/5"
            : t.tone === "warn"
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-border bg-card";
        const labelTone =
          t.tone === "bad"
            ? "text-red-700 dark:text-red-400"
            : t.tone === "warn"
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground";
        return (
          <Link
            key={t.label}
            href={t.href}
            className={`group rounded-lg border p-3 transition-colors hover:bg-muted/40 ${toneClass}`}
          >
            <div className="flex items-center gap-2">
              <Icon className={`h-3.5 w-3.5 ${labelTone}`} />
              <span
                className={`truncate text-[11px] font-medium uppercase tracking-wide ${labelTone}`}
              >
                {t.label}
              </span>
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
              {t.value.toLocaleString()}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

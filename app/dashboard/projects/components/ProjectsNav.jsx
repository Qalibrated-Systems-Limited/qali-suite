"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Milestone,
  CalendarDays,
  FileEdit,
  BookOpen,
  ClipboardList,
  Receipt,
  Wallet,
  FileSpreadsheet,
  Ruler,
} from "lucide-react";

/**
 * Module-level sub-navigation for the Projects module — same pattern as
 * HRNav (app/dashboard/hr/components/HRNav.jsx): a sticky strip of links
 * rendered once in the module layout, above every page under
 * /dashboard/projects/*. Gives every section reachable from the sidebar's
 * "Projects" dropdown a matching in-page way to jump between sections
 * without going back to the sidebar.
 */
const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard/projects", icon: LayoutDashboard, exact: true },
  { label: "Bill of Quantities", href: "/dashboard/projects/boq", icon: Ruler },
  { label: "Milestone Tracker", href: "/dashboard/projects/milestones", icon: Milestone },
  { label: "Programme", href: "/dashboard/projects/programme", icon: CalendarDays },
  { label: "Engineer's Instructions", href: "/dashboard/projects/instructions", icon: FileEdit },
  { label: "Site Diary", href: "/dashboard/projects/diary", icon: BookOpen },
  { label: "Forms Register", href: "/dashboard/projects/forms", icon: ClipboardList },
  { label: "IPC & Payments", href: "/dashboard/projects/ipc", icon: Receipt },
  { label: "Cash Requisitions", href: "/dashboard/projects/cash-requisitions", icon: Wallet },
  { label: "Monthly Report", href: "/dashboard/projects/monthly-report", icon: FileSpreadsheet },
];

export default function ProjectsNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-14 z-10 border-b border-border bg-card">
      <div className="flex items-center gap-1 overflow-x-auto px-4 sm:px-6 py-0">
        {NAV_ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${
                active
                  ? "border-primary font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

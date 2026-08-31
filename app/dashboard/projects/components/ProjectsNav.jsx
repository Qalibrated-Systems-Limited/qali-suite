"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  FileEdit,
  BookOpen,
  Receipt,
  Wallet,
  Ruler,
} from "lucide-react";

/**
 * Module-level sub-navigation for the Projects module — same pattern as
 * HRNav (app/dashboard/hr/components/HRNav.jsx): a sticky strip of links
 * rendered once in the module layout, above every page under
 * /dashboard/projects/*. Mirrors the sidebar's "Projects" dropdown, so the
 * same destinations are reachable from either place.
 *
 * SEVEN ENTRIES, DOWN FROM TEN. **A nav entry must own records.** Of the ten
 * this had, five did not: Milestone Tracker and Programme were two views of
 * `project_tasks` beside the Work breakdown card on the project detail page —
 * one table, three doors — and the Milestone Tracker did not show milestones,
 * because there is no milestone table. Forms Register was sixteen hardcoded
 * strings with a disabled button. Monthly Report is a RENDERING of four other
 * sections, which makes it something you produce, not somewhere you go.
 *
 * So: Milestone Tracker folded into Programme as a view, Forms Register became
 * a reference panel on Instructions, and Monthly Report became an action on the
 * project record. Every one of those routes still resolves — they redirect —
 * so no saved link breaks.
 *
 * IPC & Payments and Cash Requisitions run the identical pair of queries and
 * own nothing between them, and they are STILL HERE deliberately: whether they
 * are one section or two is a product decision for the author, not a review
 * finding. See PROJECTS-QALITRACK-PLAN.md §7 open question 1, §9.5 and §10.3.
 */
const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard/projects", icon: LayoutDashboard, exact: true },
  { label: "Bill of Quantities", href: "/dashboard/projects/boq", icon: Ruler },
  { label: "Programme", href: "/dashboard/projects/programme", icon: CalendarDays },
  { label: "Engineer's Instructions", href: "/dashboard/projects/instructions", icon: FileEdit },
  { label: "Site Diary", href: "/dashboard/projects/diary", icon: BookOpen },
  { label: "IPC & Payments", href: "/dashboard/projects/ipc", icon: Receipt },
  { label: "Cash Requisitions", href: "/dashboard/projects/cash-requisitions", icon: Wallet },
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

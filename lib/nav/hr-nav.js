import {
  LayoutDashboard,
  Users,
  Building2,
  Network,
  Briefcase,
  LogOut,
  Calendar,
  CalendarDays,
  CalendarCog,
  Clock,
  Banknote,
  Wallet,
  Star,
  GraduationCap,
  FileText,
  Gavel,
  BarChart3,
  Settings,
  UserCog,
  UserRound,
  HeartHandshake,
  ClipboardCheck,
  Coins,
  Sparkles,
  FolderOpen,
} from "lucide-react";
import { can } from "@/lib/capabilities";

/**
 * THE HR MENU — ONE LIST, READ BY BOTH THE SIDEBAR AND THE HR TOP BAR.
 *
 * The two used to be written separately and had drifted: different items
 * (Loans and Leave Types only in the sidebar), different names ("HR Overview"
 * and "Overview", "Disciplinary & Grievances" and "Cases") and different rules
 * for who sees what (role lists in one, capabilities in the other). Now each
 * item is written once, with the capability that shows it, in sections that
 * the sidebar renders as sub-groups and the top bar as tabs.
 *
 * `when` is a list of capabilities: the item shows if the user holds any.
 * No `when` means everyone with HR in their plan.
 */
export const HR_SECTIONS = [
  {
    id: "people",
    label: "People",
    icon: Users,
    items: [
      { id: "hr-overview", label: "Overview", href: "/dashboard/hr", icon: LayoutDashboard, when: ["hr.view"], exact: true },
      { id: "hr-employees", label: "Employees", href: "/dashboard/hr/employees", icon: Users, when: ["hr.view"] },
      { id: "hr-departments", label: "Departments", href: "/dashboard/hr/departments", icon: Building2, when: ["hr.view"] },
      { id: "hr-org-chart", label: "Org chart", href: "/dashboard/hr/org-chart", icon: Network, when: ["hr.view"] },
      { id: "hr-recruitment", label: "Recruitment", href: "/dashboard/hr/recruitment", icon: Briefcase, when: ["hr.recruit"] },
      { id: "hr-exits", label: "Exits & final dues", href: "/dashboard/hr/exits", icon: LogOut, when: ["exit.manage", "exit.approve", "exit.pay"] },
    ],
  },
  {
    id: "time",
    label: "Time & leave",
    icon: CalendarDays,
    items: [
      { id: "hr-leave", label: "Leave requests", href: "/dashboard/hr/leave", icon: Calendar, when: ["leave.approve"] },
      { id: "hr-leave-calendar", label: "Leave calendar", href: "/dashboard/hr/leave/calendar", icon: CalendarDays, when: ["leave.approve"] },
      { id: "hr-attendance", label: "Attendance", href: "/dashboard/hr/attendance", icon: Clock, when: ["attendance.mark"] },
      { id: "hr-leave-types", label: "Leave types", href: "/dashboard/hr/leave-types", icon: CalendarCog, when: ["hr.admin"] },
    ],
  },
  {
    id: "pay",
    label: "Pay",
    icon: Banknote,
    items: [
      { id: "hr-payroll", label: "Payroll", href: "/dashboard/hr/payroll", icon: Banknote, when: ["payroll.prepare", "payroll.approve"] },
      { id: "hr-loans", label: "Loans & advances", href: "/dashboard/hr/loans", icon: Wallet, when: ["loan.request", "loan.approve", "loan.disburse"] },
    ],
  },
  {
    id: "growth",
    label: "Performance",
    icon: Sparkles,
    items: [
      { id: "hr-reviews", label: "Performance reviews", href: "/dashboard/hr/reviews", icon: Star, when: ["hr.reviews"] },
      { id: "hr-training", label: "Training & certificates", href: "/dashboard/hr/training", icon: GraduationCap, when: ["hr.training"] },
    ],
  },
  {
    id: "records",
    label: "Records",
    icon: FolderOpen,
    items: [
      { id: "hr-letters", label: "Letters", href: "/dashboard/hr/letters", icon: FileText, when: ["hr.letters"] },
      { id: "hr-cases", label: "Disciplinary & grievances", href: "/dashboard/hr/cases", icon: Gavel, when: ["hr.discipline"] },
      { id: "hr-requisitions", label: "Requisitions", href: "/dashboard/requests", icon: ClipboardCheck, when: ["request.create"] },
    ],
  },
  {
    id: "insights",
    label: "Reports",
    icon: BarChart3,
    items: [
      { id: "hr-reports", label: "HR reports", href: "/dashboard/hr/reports", icon: BarChart3, when: ["hr.reports"] },
      { id: "hr-custom-reports", label: "Build a report", href: "/dashboard/reports/custom/hr", icon: BarChart3, when: ["hr.reports"] },
    ],
  },
  {
    id: "me",
    label: "My HR",
    icon: UserRound,
    items: [
      { id: "hr-my-leave", label: "My leave", href: "/dashboard/hr/my-leave", icon: Calendar },
      { id: "hr-my-attendance", label: "My attendance", href: "/dashboard/hr/my-attendance", icon: Clock },
      { id: "hr-my-payslips", label: "My payslips", href: "/dashboard/hr/my-payslips", icon: Coins },
      { id: "hr-my-reviews", label: "My reviews", href: "/dashboard/hr/my-reviews", icon: HeartHandshake },
      { id: "hr-my-letters", label: "My letters", href: "/dashboard/hr/my-letters", icon: FileText },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    items: [
      { id: "hr-settings", label: "HR settings", href: "/dashboard/hr/settings", icon: Settings, when: ["hr.admin", "payroll.rates.write"] },
      { id: "hr-users", label: "User accounts", href: "/dashboard/users", icon: UserCog, when: ["admin.manage"] },
    ],
  },
];

/**
 * The sections and items this user sees. `holds(capability)` decides; by
 * default the code's role mapping, or the caller passes one that honours the
 * company's saved Roles & Permissions.
 */
export function hrNavFor(user, holds) {
  const role = user?.role;
  const check = holds || ((cap) => safeCan(role, cap));
  // SuperAdmin has no employee record: "My HR" means nothing to them.
  const selfService = role && role !== "SuperAdmin";
  return HR_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) =>
      section.id === "me" ? selfService : !item.when || item.when.some((c) => check(c)),
    ),
  })).filter((section) => section.items.length > 0);
}

function safeCan(role, cap) {
  try {
    return can(role, cap);
  } catch {
    return false;
  }
}

/** Which section the current path belongs to (longest matching href wins). */
export function activeHrSection(sections, pathname) {
  let best = null;
  let bestLen = -1;
  for (const s of sections) {
    for (const i of s.items) {
      const hit = i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`);
      if (hit && i.href.length > bestLen) {
        best = { section: s.id, item: i.id };
        bestLen = i.href.length;
      }
    }
  }
  return best;
}

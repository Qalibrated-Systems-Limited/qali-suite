"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  Building2,
  Calendar,
  Banknote,
  LayoutDashboard,
  Clock,
} from "lucide-react";

const ADMIN_NAV = [
  { label: "Overview", href: "/dashboard/hr", icon: LayoutDashboard, exact: true },
  { label: "Employees", href: "/dashboard/hr/employees", icon: Users },
  { label: "Departments", href: "/dashboard/hr/departments", icon: Building2 },
  { label: "Leave", href: "/dashboard/hr/leave", icon: Calendar },
  { label: "Attendance", href: "/dashboard/hr/attendance", icon: Clock },
  { label: "Payroll", href: "/dashboard/hr/payroll", icon: Banknote },
];

const EMPLOYEE_NAV = [
  { label: "My Leave", href: "/dashboard/hr/my-leave", icon: Calendar },
  { label: "My Attendance", href: "/dashboard/hr/my-attendance", icon: Clock },
  { label: "My Payslips", href: "/dashboard/hr/my-payslips", icon: Banknote },
];

export default function HRNav({ role }) {
  const pathname = usePathname();
  const isAdmin = ["SuperAdmin", "Admin", "Manager", "HR"].includes(role);
  const navItems = isAdmin ? ADMIN_NAV : EMPLOYEE_NAV;

  return (
    <nav className="sticky top-14 z-10 border-b border-border bg-card">
      <div className="flex items-center gap-1 overflow-x-auto px-4 sm:px-6 py-0">
        {navItems.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
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

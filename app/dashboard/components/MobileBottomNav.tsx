"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  Package,
  ClipboardList,
  TrendingUp,
  ShoppingCart,
  Building2,
  Tag,
  Users,
  Wallet,
  Calendar,
  Activity,
  CheckSquare,
  ArrowLeftRight,
  FileSpreadsheet,
} from "lucide-react";

// ============================================
// MOBILE BOTTOM NAV
// ============================================
// Industry-standard bottom-tab pattern (Notion, Linear, Stripe mobile).
// Renders only on mobile (sm:hidden). 5 destinations max per role —
// the most-used pages for that role. Falls back to a generic set for
// roles without a tailored map.
//
// Accessibility: semantic <nav>, aria-current on active, generous tap
// targets (h-14), label always visible (no icon-only).

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const ROLE_NAVS: Record<string, NavItem[]> = {
  // Finance leadership
  CFO: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Approvals", href: "/dashboard/approvals", icon: CheckSquare },
    { label: "Bills", href: "/dashboard/bills", icon: Receipt },
    { label: "Reports", href: "/dashboard/reports/profit-loss", icon: TrendingUp },
    { label: "Journal", href: "/dashboard/journal", icon: FileSpreadsheet },
  ],
  "Finance Manager": [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Approvals", href: "/dashboard/approvals", icon: CheckSquare },
    { label: "Bills", href: "/dashboard/bills", icon: Receipt },
    { label: "Reports", href: "/dashboard/reports/profit-loss", icon: TrendingUp },
    { label: "Journal", href: "/dashboard/journal", icon: FileSpreadsheet },
  ],
  Accountant: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Bills", href: "/dashboard/bills", icon: Receipt },
    { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
    { label: "Journal", href: "/dashboard/journal", icon: FileSpreadsheet },
    { label: "Reports", href: "/dashboard/reports/trial-balance", icon: TrendingUp },
  ],

  // Commercial
  "Sales Manager": [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
    { label: "Pricing", href: "/dashboard/stocks", icon: Tag },
    { label: "Customers", href: "/dashboard/customers", icon: Users },
    { label: "Sales", href: "/dashboard/reports/sales", icon: TrendingUp },
  ],

  // Procurement
  "Procurement Officer": [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "POs", href: "/dashboard/purchase-orders", icon: ShoppingCart },
    { label: "Bills", href: "/dashboard/bills", icon: Receipt },
    { label: "Suppliers", href: "/dashboard/suppliers", icon: Building2 },
    { label: "Stock", href: "/dashboard/stocks", icon: Package },
  ],

  // Inventory custody
  "Store Manager": [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Stock", href: "/dashboard/stocks", icon: Package },
    { label: "Requests", href: "/dashboard/requests", icon: ClipboardList },
    { label: "Movements", href: "/dashboard/movements", icon: ArrowLeftRight },
    { label: "Checkouts", href: "/dashboard/checkout", icon: Activity },
  ],
  Storekeeper: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Stock", href: "/dashboard/stocks", icon: Package },
    { label: "Requests", href: "/dashboard/requests", icon: ClipboardList },
    { label: "Checkouts", href: "/dashboard/checkout", icon: Activity },
    { label: "Movements", href: "/dashboard/movements", icon: ArrowLeftRight },
  ],

  // HR
  HR: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Employees", href: "/dashboard/hr/employees", icon: Users },
    { label: "Leave", href: "/dashboard/hr/leave", icon: Calendar },
    { label: "Payroll", href: "/dashboard/hr/payroll", icon: Wallet },
    { label: "Attendance", href: "/dashboard/hr/attendance", icon: Activity },
  ],

  // Manager (operations)
  Manager: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Approvals", href: "/dashboard/approvals", icon: CheckSquare },
    { label: "Stock", href: "/dashboard/stocks", icon: Package },
    { label: "Requests", href: "/dashboard/requests", icon: ClipboardList },
    { label: "Reports", href: "/dashboard/reports/sales", icon: TrendingUp },
  ],

  // Admin
  Admin: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Approvals", href: "/dashboard/approvals", icon: CheckSquare },
    { label: "Stock", href: "/dashboard/stocks", icon: Package },
    { label: "Bills", href: "/dashboard/bills", icon: Receipt },
    { label: "Reports", href: "/dashboard/reports/profit-loss", icon: TrendingUp },
  ],
  SuperAdmin: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Companies", href: "/dashboard/admin/companies", icon: Building2 },
    { label: "Users", href: "/dashboard/users", icon: Users },
    { label: "Stock", href: "/dashboard/stocks", icon: Package },
    { label: "Bills", href: "/dashboard/bills", icon: Receipt },
  ],
};

// Personal default: claims, leave, checkouts.
const DEFAULT_NAV: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Claims", href: "/dashboard/my-claims", icon: Receipt },
  { label: "Leave", href: "/dashboard/hr/my-leave", icon: Calendar },
  { label: "Checkouts", href: "/dashboard/checkout", icon: Package },
  { label: "Stock", href: "/dashboard/stocks", icon: Package },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function MobileBottomNav({ role }: { role?: string }) {
  const pathname = usePathname();
  const items = (role && ROLE_NAVS[role]) || DEFAULT_NAV;

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="grid h-14 grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium transition-colors ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground active:text-foreground"
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${active ? "" : "opacity-80"}`}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
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
  LayoutGrid,
  BarChart3,
  FileText,
  Target,
  Briefcase,
  BookOpen,
  Landmark,
  FolderKanban,
  Settings,
  HandCoins,
  ScrollText,
  ClipboardCheck,
  Plug,
} from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent as DrawerContentJs,
  DrawerHeader as DrawerHeaderJs,
  DrawerTitle as DrawerTitleJs,
  DrawerTrigger,
} from "@/components/ui/drawer";

// drawer.jsx is untyped (plain forwardRef) — TS infers prop-less components
// in a .tsx consumer. Relax locally instead of converting the shared file.
const DrawerContent = DrawerContentJs as React.ComponentType<
  React.PropsWithChildren<{ className?: string }>
>;
const DrawerHeader = DrawerHeaderJs as React.ComponentType<
  React.PropsWithChildren<{ className?: string }>
>;
const DrawerTitle = DrawerTitleJs as React.ComponentType<
  React.PropsWithChildren<{ className?: string }>
>;
import {
  canSeeInventoryNav,
  canSeeSalesNav,
  canSeePurchasesNav,
  canSeeFinanceNav,
  canSeeReportsNav,
  canSeeProjectsNav,
  canSeeHRNav,
  canSeeSettingsNav,
} from "@/lib/permissions";

// ============================================
// MOBILE BOTTOM NAV
// ============================================
// Bottom-tab pattern: 4 role-tailored destinations + "More", which opens
// a grouped bottom sheet (vaul drawer) with every section the role can
// see — so nothing requires reaching for the top-left hamburger
// one-handed. Renders only on mobile (sm:hidden).
//
// Accessibility: semantic <nav>, aria-current on active, h-16 tap
// targets, labels always visible.

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

// 4 primary tabs per role (the 5th slot is "More").
const ROLE_NAVS: Record<string, NavItem[]> = {
  // Executive — overview-first, read-oriented
  CEO: [
    { label: "Overview", href: "/dashboard", icon: TrendingUp },
    { label: "Reports", href: "/dashboard/reports/profit-loss", icon: BarChart3 },
    { label: "Pipeline", href: "/dashboard/opportunities", icon: Briefcase },
    { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
  ],
  CFO: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Approvals", href: "/dashboard/approvals", icon: CheckSquare },
    { label: "Bills", href: "/dashboard/bills", icon: Receipt },
    { label: "Reports", href: "/dashboard/reports/profit-loss", icon: TrendingUp },
  ],
  "Finance Manager": [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Approvals", href: "/dashboard/approvals", icon: CheckSquare },
    { label: "Bills", href: "/dashboard/bills", icon: Receipt },
    { label: "Reports", href: "/dashboard/reports/profit-loss", icon: TrendingUp },
  ],
  Accountant: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Bills", href: "/dashboard/bills", icon: Receipt },
    { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
    { label: "Journal", href: "/dashboard/journal", icon: FileSpreadsheet },
  ],
  "Sales Manager": [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Pipeline", href: "/dashboard/opportunities", icon: Briefcase },
    { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
    { label: "Customers", href: "/dashboard/customers", icon: Users },
  ],
  "Procurement Officer": [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "POs", href: "/dashboard/purchase-orders", icon: ShoppingCart },
    { label: "Bills", href: "/dashboard/bills", icon: Receipt },
    { label: "Suppliers", href: "/dashboard/suppliers", icon: Building2 },
  ],
  "Store Manager": [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Products", href: "/dashboard/stocks", icon: Package },
    { label: "Requests", href: "/dashboard/requests", icon: ClipboardList },
    { label: "Movements", href: "/dashboard/movements", icon: ArrowLeftRight },
  ],
  Storekeeper: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Products", href: "/dashboard/stocks", icon: Package },
    { label: "Requests", href: "/dashboard/requests", icon: ClipboardList },
    { label: "Checkouts", href: "/dashboard/checkout", icon: Activity },
  ],
  HR: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Employees", href: "/dashboard/hr/employees", icon: Users },
    { label: "Leave", href: "/dashboard/hr/leave", icon: Calendar },
    { label: "Payroll", href: "/dashboard/hr/payroll", icon: Wallet },
  ],
  Manager: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Approvals", href: "/dashboard/approvals", icon: CheckSquare },
    { label: "Products", href: "/dashboard/stocks", icon: Package },
    { label: "Requests", href: "/dashboard/requests", icon: ClipboardList },
  ],
  // Company admin runs the COMPANY (approvals, oversight, configuration) —
  // day-to-day inventory belongs to store roles, not here.
  Admin: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Approvals", href: "/dashboard/approvals", icon: CheckSquare },
    { label: "Reports", href: "/dashboard/reports/profit-loss", icon: TrendingUp },
    { label: "Settings", href: "/dashboard/settings", icon: Settings },
  ],
  // SuperAdmin is the PLATFORM operator — cross-tenant. A single tenant's
  // stock is meaningless at this level; their job is companies, users and
  // platform plumbing.
  SuperAdmin: [
    { label: "Home", href: "/dashboard", icon: LayoutDashboard },
    { label: "Companies", href: "/dashboard/admin/companies", icon: Building2 },
    { label: "Users", href: "/dashboard/users", icon: Users },
    { label: "Integrations", href: "/dashboard/integrations", icon: Plug },
  ],
};

const DEFAULT_NAV: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Expenses", href: "/dashboard/my-claims", icon: Receipt },
  { label: "Leave", href: "/dashboard/hr/my-leave", icon: Calendar },
  { label: "Checkouts", href: "/dashboard/checkout", icon: Package },
];

// The "More" sheet: every section, grouped, filtered by the same role
// gates the sidebar uses. Tiles, not a list — faster to scan and tap.
type NavGroup = {
  label: string;
  visible: (role?: string) => boolean;
  items: NavItem[];
};

const MORE_GROUPS: NavGroup[] = [
  {
    label: "Sales & CRM",
    visible: (r) => canSeeSalesNav(r),
    items: [
      { label: "Leads", href: "/dashboard/leads", icon: Target },
      { label: "Pipeline", href: "/dashboard/opportunities", icon: Briefcase },
      { label: "Quotes", href: "/dashboard/quotes", icon: FileText },
      { label: "Sales Orders", href: "/dashboard/sales-orders", icon: ClipboardCheck },
      { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
      { label: "Customers", href: "/dashboard/customers", icon: Users },
    ],
  },
  {
    label: "Inventory",
    visible: (r) => canSeeInventoryNav(r),
    items: [
      { label: "Products", href: "/dashboard/stocks", icon: Package },
      { label: "Movements", href: "/dashboard/movements", icon: ArrowLeftRight },
      { label: "GRN", href: "/dashboard/grn", icon: ClipboardCheck },
      { label: "Adjustments", href: "/dashboard/adjustments", icon: FileText },
      { label: "Requests", href: "/dashboard/requests", icon: ClipboardList },
      { label: "Checkouts", href: "/dashboard/checkout", icon: Activity },
    ],
  },
  {
    label: "Purchases",
    visible: (r) => canSeePurchasesNav(r),
    items: [
      { label: "POs", href: "/dashboard/purchase-orders", icon: ShoppingCart },
      { label: "Bills", href: "/dashboard/bills", icon: Receipt },
      { label: "Suppliers", href: "/dashboard/suppliers", icon: Building2 },
    ],
  },
  {
    label: "Finance",
    visible: (r) => canSeeFinanceNav(r),
    items: [
      { label: "Journal", href: "/dashboard/journal", icon: FileSpreadsheet },
      { label: "Accounts", href: "/dashboard/accounts", icon: BookOpen },
      { label: "Banking", href: "/dashboard/banking", icon: Landmark },
      { label: "Payments", href: "/dashboard/payments/received", icon: Wallet },
      { label: "Pricing", href: "/dashboard/stocks", icon: Tag },
    ],
  },
  {
    label: "Reports",
    visible: (r) => canSeeReportsNav(r),
    items: [
      { label: "P&L", href: "/dashboard/reports/profit-loss", icon: TrendingUp },
      { label: "Balance Sheet", href: "/dashboard/reports/balance-sheet", icon: ScrollText },
      { label: "AR Aging", href: "/dashboard/reports/ar-aging", icon: TrendingUp },
      { label: "Sales", href: "/dashboard/reports/sales", icon: TrendingUp },
    ],
  },
  {
    label: "Projects & HR",
    visible: (r) => canSeeProjectsNav(r) || canSeeHRNav(r),
    items: [
      { label: "Projects", href: "/dashboard/projects", icon: FolderKanban },
      { label: "Employees", href: "/dashboard/hr/employees", icon: Users },
      { label: "Payroll", href: "/dashboard/hr/payroll", icon: Wallet },
      { label: "Leave", href: "/dashboard/hr/leave", icon: Calendar },
    ],
  },
  {
    label: "Personal",
    visible: () => true,
    items: [
      { label: "My Expenses", href: "/dashboard/my-claims", icon: HandCoins },
      { label: "My Leave", href: "/dashboard/hr/my-leave", icon: Calendar },
      { label: "My Payslips", href: "/dashboard/hr/my-payslips", icon: ScrollText },
    ],
  },
  {
    label: "Admin",
    visible: (r) => canSeeSettingsNav(r),
    items: [
      { label: "Users", href: "/dashboard/users", icon: Users },
      { label: "Company", href: "/dashboard/company", icon: Building2 },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
      { label: "Integrations", href: "/dashboard/integrations", icon: Plug },
    ],
  },
  // Platform-level (SuperAdmin only) — surfaced FIRST for that role.
  {
    label: "Platform",
    visible: (r) => r === "SuperAdmin",
    items: [
      { label: "Companies", href: "/dashboard/admin/companies", icon: Building2 },
      { label: "Users", href: "/dashboard/users", icon: Users },
      { label: "Integrations", href: "/dashboard/integrations", icon: Plug },
    ],
  },
];

// ============================================
// ROLE → GROUP PRIORITY (the "More" sheet leads with the user's core
// function, not a fixed order). Groups not listed for a role keep their
// declared order, after the listed ones. "Platform" only exists for
// SuperAdmin (its visible() gate).
// ============================================
const ROLE_GROUP_ORDER: Record<string, string[]> = {
  CEO: ["Reports", "Sales & CRM", "Finance", "Purchases"],
  SuperAdmin: ["Platform", "Admin", "Reports", "Finance"],
  Admin: ["Admin", "Reports", "Finance", "Sales & CRM", "Inventory"],
  CFO: ["Finance", "Reports", "Purchases", "Sales & CRM"],
  "Finance Manager": ["Finance", "Reports", "Purchases", "Sales & CRM"],
  Accountant: ["Finance", "Purchases", "Sales & CRM", "Reports"],
  "Sales Manager": ["Sales & CRM", "Reports", "Finance", "Inventory"],
  "Procurement Officer": ["Purchases", "Inventory", "Finance", "Reports"],
  "Store Manager": ["Inventory", "Purchases", "Reports"],
  Storekeeper: ["Inventory", "Purchases", "Personal"],
  HR: ["Projects & HR", "Personal", "Reports"],
  Manager: ["Inventory", "Sales & CRM", "Reports", "Projects & HR"],
};
// Roles without a tailored map (Employee, Technician, Viewer…) lead with
// their own stuff.
const DEFAULT_GROUP_ORDER = ["Personal"];

function orderedGroupsForRole(role?: string): NavGroup[] {
  const visible = MORE_GROUPS.filter((g) => g.visible(role));
  const pref = (role && ROLE_GROUP_ORDER[role]) || DEFAULT_GROUP_ORDER;
  const rank = (g: NavGroup, i: number) => {
    const idx = pref.indexOf(g.label);
    return idx === -1 ? pref.length + i : idx; // unlisted keep declared order
  };
  return visible
    .map((g, i) => ({ g, r: rank(g, i) }))
    .sort((a, b) => a.r - b.r)
    .map(({ g }) => g);
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

function Tab({
  active,
  icon: Icon,
  label,
}: {
  active: boolean;
  icon: NavItem["icon"];
  label: string;
}) {
  return (
    <span className="flex h-full flex-col items-center justify-center gap-0.5">
      <span
        className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
          active ? "bg-primary/12 text-primary" : "text-muted-foreground"
        }`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span
        className={`max-w-full truncate text-[10px] font-medium ${
          active ? "text-primary" : "text-muted-foreground"
        }`}
      >
        {label}
      </span>
    </span>
  );
}

export default function MobileBottomNav({ role }: { role?: string }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = (role && ROLE_NAVS[role]) || DEFAULT_NAV;
  const groups = orderedGroupsForRole(role);
  // "More" lights up when the current page isn't one of the 4 tabs.
  const onTabbedPage = items.some((i) => isActive(pathname, i.href));

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="grid h-16 grid-cols-5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="block h-full active:opacity-70"
              >
                <Tab active={active} icon={item.icon} label={item.label} />
              </Link>
            </li>
          );
        })}

        {/* More — full grouped nav as a bottom sheet */}
        <li>
          <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
            <DrawerTrigger asChild>
              <button
                type="button"
                className="block h-full w-full active:opacity-70"
                aria-label="More navigation"
              >
                <Tab active={!onTabbedPage} icon={LayoutGrid} label="More" />
              </button>
            </DrawerTrigger>
            <DrawerContent className="max-h-[85vh]">
              <DrawerHeader className="pb-1">
                <DrawerTitle>All sections</DrawerTitle>
              </DrawerHeader>
              <div className="overflow-y-auto px-4 pb-8">
                {groups.map((g) => (
                  <div key={g.label} className="mt-4 first:mt-1">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {g.label}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {g.items.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(pathname, item.href);
                        return (
                          <DrawerClose asChild key={`${g.label}-${item.href}`}>
                            <Link
                              href={item.href}
                              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-colors active:opacity-70 ${
                                active
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-border bg-background text-foreground"
                              }`}
                            >
                              <Icon className="h-5 w-5" aria-hidden="true" />
                              <span className="w-full truncate text-[11px] font-medium leading-tight">
                                {item.label}
                              </span>
                            </Link>
                          </DrawerClose>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </DrawerContent>
          </Drawer>
        </li>
      </ul>
    </nav>
  );
}

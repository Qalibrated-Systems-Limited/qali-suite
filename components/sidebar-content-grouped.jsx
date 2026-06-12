"use client";

import {
  Boxes,
  LayoutDashboard,
  List,
  Package,
  Settings,
  Users,
  Activity,
  LogOut,
  Receipt,
  FileText,
  User,
  ChevronDown,
  ChevronRight,
  DollarSign,
  CreditCard,
  Wallet,
  FileSpreadsheet,
  BookOpen,
  BarChart3,
  TrendingUp,
  Building2,
  ArrowLeftRight,
  Briefcase,
  ShoppingBag,
  ShoppingCart,
  Calendar,
  FolderTree,
  FolderKanban,
  Clock,
  Search,
  Plug,
  CheckSquare,
  ClipboardCheck,
  ShieldAlert,
  Target,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "./ui/dropdown-menu";
import { getInitials } from "@/lib/utils";
import { logout } from "@/app/mongodb/actions/auth-actions";
import { NextThemeToggler } from "./NextThemeToggler";
import { useState, useEffect } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { QaliSuiteIcon, QaliSuiteMark } from "./qalisuite-logo";
import { SidebarClockWidget } from "./sidebar-clock-widget";
import { useCommandPalette } from "./command-palette-provider";

// ============================================
// PLAN GATING HELPER
// ============================================
import { getAllowedModules } from "@/lib/plans";
import {
  canSeeInventoryNav,
  canSeeSalesNav,
  canSeePurchasesNav,
  canSeeFinanceNav,
  canSeeTaxNav,
  canSeeReportsNav,
  canSeeProjectsNav,
  canSeeHRNav,
  canSeeSettingsNav,
  canReviewClaims,
  canSeeApprovalsNav,
} from "@/lib/permissions";

// ============================================
// NAV GROUP CONFIGURATION - ERP FOCUSED
// ============================================
const getNavigationGroups = (user) => {
  const plan = user?.companyPlan || "free";
  const allowed = new Set(getAllowedModules(plan));
  const hasMod = (id) => user?.role === "SuperAdmin" || allowed.has(id);

  return [
  // Dashboard (ungrouped)
  {
    type: "single",
    icon: LayoutDashboard,
    label: "Dashboard",
    id: "dashboard",
    href: "/dashboard",
  },

  // Approvals (ungrouped — visible only to approver roles)
  {
    type: "single",
    icon: CheckSquare,
    label: "Approvals",
    id: "approvals",
    href: "/dashboard/approvals",
    hidden: !canSeeApprovalsNav(user?.role),
  },

  // Executive overview (ungrouped — the business at a glance)
  {
    type: "single",
    icon: TrendingUp,
    label: "Executive",
    id: "executive",
    href: "/dashboard/executive",
    // CEO reaches this via "Dashboard" (which redirects here) — showing both
    // was redundant. Only SuperAdmin needs the explicit entry.
    hidden: user?.role !== "SuperAdmin",
  },

  // KPIs (ungrouped — executive scorecard, same audience as Reports)
  {
    type: "single",
    icon: Target,
    label: "KPIs",
    id: "kpis",
    href: "/dashboard/kpis",
    hidden: !canSeeReportsNav(user?.role),
  },

  // ============================================
  // INVENTORY & PRODUCTS
  // ============================================
  {
    type: "group",
    label: "Inventory",
    icon: Package,
    id: "inventory",
    defaultOpen: true,
    hidden: !canSeeInventoryNav(user?.role),
    items: [
      {
        icon: Boxes,
        label: "Products",
        id: "products",
        href: "/dashboard/stocks",
        hidden: !canSeeInventoryNav(user?.role),
      },
      {
        icon: FolderTree,
        label: "Categories",
        id: "categories",
        href: "/dashboard/categories",
        hidden: !canSeeInventoryNav(user?.role),
      },
      {
        icon: Activity,
        label: "Stock Movements",
        id: "movements",
        href: "/dashboard/movements",
        hidden: !canSeeInventoryNav(user?.role),
      },
      {
        icon: ClipboardCheck,
        label: "Goods Receipt Notes",
        id: "grn",
        href: "/dashboard/grn",
        hidden: !canSeeInventoryNav(user?.role),
      },
      {
        icon: ShieldAlert,
        label: "Nonconformance (NCR)",
        id: "ncr",
        href: "/dashboard/ncr",
        hidden: !canSeeInventoryNav(user?.role),
      },
      {
        icon: FileText,
        label: "Stock Adjustments",
        id: "adjustments",
        href: "/dashboard/adjustments",
        hidden: !canSeeInventoryNav(user?.role),
      },
      {
        icon: Package,
        label: "Item Checkouts",
        id: "checkout",
        href: "/dashboard/checkout",
      },
      {
        icon: List,
        label: "Stock Requests",
        id: "requests",
        href: "/dashboard/requests",
      },
    ],
  },

  // ============================================
  // SALES
  // ============================================
  {
    type: "group",
    label: "CRM",
    icon: Target,
    id: "crm",
    defaultOpen: false,
    hidden: !canSeeSalesNav(user?.role),
    items: [
      {
        icon: Users,
        label: "Leads",
        id: "leads",
        href: "/dashboard/leads",
        hidden: !canSeeSalesNav(user?.role),
      },
      {
        icon: Briefcase,
        label: "Pipeline",
        id: "opportunities",
        href: "/dashboard/opportunities",
        hidden: !canSeeSalesNav(user?.role),
      },
    ],
  },
  {
    type: "group",
    label: "Sales",
    icon: ShoppingBag,
    id: "sales",
    defaultOpen: false,
    hidden: !canSeeSalesNav(user?.role),
    items: [
      {
        icon: FileText,
        label: "Quotes",
        id: "quotes",
        href: "/dashboard/quotes",
        hidden: !canSeeSalesNav(user?.role),
      },
      {
        icon: ClipboardCheck,
        label: "Sales Orders",
        id: "sales-orders",
        href: "/dashboard/sales-orders",
        hidden: !canSeeSalesNav(user?.role),
      },
      {
        icon: Receipt,
        label: "Invoices",
        id: "invoices",
        href: "/dashboard/invoices",
        hidden: !canSeeSalesNav(user?.role),
      },
      {
        icon: Receipt,
        label: "Credit Notes",
        id: "credit-notes",
        href: "/dashboard/credit-notes",
        hidden: !canSeeSalesNav(user?.role),
      },
      {
        icon: Users,
        label: "Customers",
        id: "customers",
        href: "/dashboard/customers",
        hidden: !canSeeSalesNav(user?.role),
      },
      {
        icon: CreditCard,
        label: "Payments Received",
        id: "payments-received",
        href: "/dashboard/payments/received",
        hidden: !canSeeFinanceNav(user?.role),
      },
      {
        icon: FileText,
        label: "Statements",
        id: "statements",
        href: "/dashboard/statements",
        hidden: !canSeeFinanceNav(user?.role),
      },
    ],
  },

  // ============================================
  // PURCHASES
  // ============================================
  {
    type: "group",
    label: "Purchases",
    icon: ShoppingCart,
    id: "purchases",
    defaultOpen: false,
    hidden: !canSeePurchasesNav(user?.role) || !hasMod("purchases"),
    items: [
      {
        icon: FileText,
        label: "Purchase Orders",
        id: "purchase-orders",
        href: "/dashboard/purchase-orders",
        hidden: !canSeePurchasesNav(user?.role),
      },
      {
        icon: Receipt,
        label: "Bills",
        id: "bills",
        href: "/dashboard/bills",
        hidden: !canSeeFinanceNav(user?.role) && user?.role !== "Procurement Officer",
      },
      {
        icon: Users,
        label: "Suppliers",
        id: "suppliers",
        href: "/dashboard/suppliers",
        hidden: !canSeePurchasesNav(user?.role),
      },
      {
        icon: Wallet,
        label: "Payments Made",
        id: "payments-made",
        href: "/dashboard/payments/made",
        hidden: !canSeeFinanceNav(user?.role),
      },
      {
        icon: FileText,
        label: "Supplier Statements",
        id: "supplier-statements",
        href: "/dashboard/supplier-statements",
        hidden: !canSeeFinanceNav(user?.role),
      },
    ],
  },

  // ============================================
  // EXPENSES
  // ============================================
  {
    type: "group",
    label: "Expenses",
    icon: Wallet,
    id: "expenses",
    defaultOpen: false,
    items: [
      {
        icon: Receipt,
        label: "My Expenses",
        id: "my-claims",
        href: "/dashboard/my-claims",
      },

      {
        icon: Wallet,
        label: "Employee Expenses",
        id: "all-claims",
        href: "/dashboard/claims",
        hidden: !canReviewClaims(user?.role) || !hasMod("all-claims"),
      },
      {
        icon: Receipt,
        label: "Operating Expenses",
        id: "expenses",
        href: "/dashboard/expenses",
        hidden: !canReviewClaims(user?.role) || !hasMod("all-claims"),
      },
    ],
  },

  // ============================================
  // PROJECTS
  // ============================================
  {
    type: "single",
    icon: FolderKanban,
    label: "Projects",
    id: "projects",
    href: "/dashboard/projects",
    hidden: !canSeeProjectsNav(user?.role) || !hasMod("projects"),
    // HR intentionally excluded via the permission group
  },

  // ============================================
  // FINANCE & ACCOUNTING
  // ============================================
  {
    type: "group",
    label: "Finance",
    icon: DollarSign,
    id: "finance",
    defaultOpen: false,
    hidden: !canSeeFinanceNav(user?.role) || !hasMod("finance"),
    items: [
      {
        icon: Briefcase, // or Building2 or Users
        label: "Parties",
        id: "parties",
        href: "/dashboard/parties",
        hidden: !canSeeFinanceNav(user?.role),
      },
      {
        icon: BookOpen,
        label: "Chart of Accounts",
        id: "accounts",
        href: "/dashboard/accounts",
        hidden: !canSeeFinanceNav(user?.role),
      },
      {
        icon: FileSpreadsheet,
        label: "Journal Entries",
        id: "journal",
        href: "/dashboard/journal",
        hidden: !canSeeFinanceNav(user?.role),
      },
      {
        icon: ArrowLeftRight,
        label: "Bank Feed",
        id: "bank-feed",
        href: "/dashboard/banking",
        hidden: !canSeeFinanceNav(user?.role),
      },
      {
        icon: Package,
        label: "Fixed Assets",
        id: "assets",
        href: "/dashboard/assets",
        hidden: !canSeeFinanceNav(user?.role) || !hasMod("assets"),
      },
      {
        icon: Calendar,
        label: "Fiscal Periods",
        id: "fiscal-periods",
        href: "/dashboard/settings/fiscal-periods",
        hidden: !canSeeFinanceNav(user?.role),
      },
    ],
  },

  // ============================================
  // TAX MANAGEMENT
  // ============================================
  {
    type: "group",
    label: "Taxes",
    icon: FileText,
    id: "tax",
    defaultOpen: false,
    hidden: !canSeeTaxNav(user?.role) || !hasMod("tax"),
    items: [
      {
        icon: Receipt,
        label: "VAT Returns",
        id: "vat-returns",
        href: "/dashboard/tax/vat",
        hidden: !canSeeTaxNav(user?.role),
      },
      {
        icon: FileText,
        label: "WHT Reports",
        id: "wht-reports",
        href: "/dashboard/tax/wht",
        hidden: !canSeeTaxNav(user?.role),
      },
      {
        icon: FileSpreadsheet,
        label: "Tax Transactions",
        id: "tax-transactions",
        href: "/dashboard/tax/transactions",
        hidden: !canSeeTaxNav(user?.role),
      },
      {
        icon: Building2,
        label: "KRA Filings",
        id: "kra-filings",
        href: "/dashboard/tax/kra",
        hidden: !canSeeTaxNav(user?.role),
      },
    ],
  },

  // ============================================
  // REPORTS & ANALYTICS
  // ============================================
  {
    type: "group",
    label: "Reports",
    icon: BarChart3,
    id: "reports",
    defaultOpen: false,
    hidden: !canSeeReportsNav(user?.role),
    items: [
      // Financial Reports — finance roles only (P&L, Balance Sheet, etc.)
      {
        icon: TrendingUp,
        label: "Profit & Loss",
        id: "profit-loss",
        href: "/dashboard/reports/profit-loss",
        hidden: !canSeeFinanceNav(user?.role) || !hasMod("profit-loss"),
      },
      {
        icon: Building2,
        label: "Balance Sheet",
        id: "balance-sheet",
        href: "/dashboard/reports/balance-sheet",
        hidden: !canSeeFinanceNav(user?.role) || !hasMod("balance-sheet"),
      },
      {
        icon: Activity,
        label: "Cash Flow",
        id: "cash-flow",
        href: "/dashboard/reports/cash-flow",
        hidden: !canSeeFinanceNav(user?.role) || !hasMod("cash-flow"),
      },
      {
        icon: FileSpreadsheet,
        label: "Trial Balance",
        id: "trial-balance",
        href: "/dashboard/reports/trial-balance",
        hidden: !canSeeFinanceNav(user?.role) || !hasMod("trial-balance"),
      },
      {
        icon: BookOpen,
        label: "General Ledger",
        id: "general-ledger",
        href: "/dashboard/reports/general-ledger",
        hidden: !canSeeFinanceNav(user?.role) || !hasMod("general-ledger"),
      },
      {
        icon: Users,
        label: "AR Aging",
        id: "ar-aging",
        href: "/dashboard/reports/ar-aging",
        hidden: !canSeeFinanceNav(user?.role) || !hasMod("ar-aging"),
      },
      {
        icon: Building2,
        label: "AP Aging",
        id: "ap-aging",
        href: "/dashboard/reports/ap-aging",
        hidden: !canSeeFinanceNav(user?.role) || !hasMod("ap-aging"),
      },
      {
        icon: Package,
        label: "Asset Rollforward",
        id: "asset-rollforward",
        href: "/dashboard/reports/asset-rollforward",
        hidden: !canSeeFinanceNav(user?.role) || !hasMod("assets"),
      },

      // Operational Reports — broader audience matching the underlying nav.
      {
        icon: Package,
        label: "Inventory Reports",
        id: "inventory-reports",
        href: "/dashboard/reports/inventory",
        hidden: !canSeeInventoryNav(user?.role),
      },
      {
        icon: ShoppingBag,
        label: "Sales Reports",
        id: "sales-reports",
        href: "/dashboard/reports/sales",
        hidden: !canSeeSalesNav(user?.role),
      },
      {
        icon: ShoppingCart,
        label: "Purchase Report",
        id: "purchase-report",
        href: "/dashboard/reports/purchases",
        hidden: !canSeePurchasesNav(user?.role),
      },
    ],
  },

  // ============================================
  // HUMAN RESOURCES
  // ============================================
  {
    type: "group",
    label: "Human Resources",
    icon: Briefcase,
    id: "hr",
    defaultOpen: user?.role === "HR",
    hidden: !hasMod("hr"),
    items: [
      {
        icon: LayoutDashboard,
        label: "HR Overview",
        id: "hr-overview",
        href: "/dashboard/hr",
        hidden: !canSeeHRNav(user?.role),
      },
      {
        icon: Users,
        label: "Employees",
        id: "hr-employees",
        href: "/dashboard/hr/employees",
        hidden: !canSeeHRNav(user?.role),
      },
      {
        icon: Building2,
        label: "Departments",
        id: "hr-departments",
        href: "/dashboard/hr/departments",
        hidden: !canSeeHRNav(user?.role),
      },
      {
        icon: Calendar,
        label: "Leave",
        id: "hr-leave",
        href: ["Admin", "HR", "Manager"].includes(user?.role) ? "/dashboard/hr/leave" : "/dashboard/hr/my-leave",
        hidden: user?.role === "SuperAdmin",
      },
      {
        icon: Calendar,
        label: "Leave Types",
        id: "hr-leave-types",
        href: "/dashboard/hr/leave-types",
        // Config screen — only Admin / HR (matches the action gate).
        hidden: !["Admin", "HR"].includes(user?.role),
      },
      {
        icon: Clock,
        label: "Attendance",
        id: "hr-attendance",
        href: ["Admin", "HR", "Manager"].includes(user?.role) ? "/dashboard/hr/attendance" : "/dashboard/hr/my-attendance",
        hidden: user?.role === "SuperAdmin",
      },
      {
        icon: DollarSign,
        label: ["Admin", "HR"].includes(user?.role) ? "Payroll" : "My Payslips",
        id: "hr-payroll",
        href: ["Admin", "HR"].includes(user?.role) ? "/dashboard/hr/payroll" : "/dashboard/hr/my-payslips",
        hidden: user?.role === "SuperAdmin",
      },
      {
        icon: Wallet,
        label: ["Admin", "HR", "Manager"].includes(user?.role) ? "Loans & Advances" : "My Loans",
        id: "hr-loans",
        href: "/dashboard/hr/loans",
        hidden: user?.role === "SuperAdmin",
      },
      {
        icon: Users,
        label: "User Accounts",
        id: "hr-users",
        href: "/dashboard/users",
        hidden: user?.role !== "HR",
      },
    ],
  },

  // ============================================
  // PEOPLE & ADMIN
  // ============================================
  {
    type: "group",
    label: "People",
    icon: Users,
    id: "people",
    defaultOpen: false,
    items: [
      {
        icon: Users,
        label: "Users",
        id: "users",
        href: "/dashboard/users",
        hidden: !["Admin", "SuperAdmin"].includes(user?.role),
      },
      {
        icon: Building2,
        label: "Companies",
        id: "companies",
        href: "/dashboard/admin/companies",
        hidden: user?.role !== "SuperAdmin",
      },
    ],
  },

  // ============================================
  // COMPANY SETTINGS (for Admin)
  // ============================================
  {
    type: "single",
    icon: Building2,
    label: "Company",
    id: "company",
    href: "/dashboard/company",
    hidden: !["Admin", "SuperAdmin"].includes(user?.role),
  },

  // ============================================
  // INTEGRATIONS (ungrouped, Enterprise + Admin only)
  // ============================================
  {
    type: "single",
    icon: Plug,
    label: "Integrations",
    id: "integration",
    href: "/dashboard/integrations",
    hidden: user?.role !== "Admin" || !hasMod("integration"),
  },

  // ============================================
  // SETTINGS (ungrouped)
  // ============================================
  {
    type: "single",
    icon: Settings,
    label: "Settings",
    id: "settings",
    href: "/dashboard/settings",
    hidden: !canSeeSettingsNav(user?.role) && user?.role !== "HR",
  },
];
}; // end getNavigationGroups

// ============================================
// COMPONENTS
// ============================================

const NavGroup = ({ group, user, onItemClick, collapsed }) => {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(group.defaultOpen ?? false);

  // Check if any child is active
  const hasActiveChild = group.items?.some((item) => {
    if (item.hidden) return false;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  });

  // Auto-open if has active child
  useEffect(() => {
    if (hasActiveChild) {
      setIsOpen(true);
    }
  }, [hasActiveChild]);

  const visibleItems = group.items?.filter((item) => !item.hidden) || [];

  if (visibleItems.length === 0) return null;

  // Collapsed: show group icon as a dropdown menu
  if (collapsed) {
    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className={clsx(
                  "w-full flex items-center justify-center p-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  "text-muted-foreground hover:bg-accent hover:text-foreground",
                  { "bg-accent/50 text-foreground": hasActiveChild }
                )}
              >
                <group.icon className="w-5 h-5 shrink-0" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {group.label}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="start" className="w-48 bg-card border-border" sideOffset={8}>
          <DropdownMenuLabel className="text-xs text-muted-foreground">{group.label}</DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-border" />
          {visibleItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <DropdownMenuItem key={item.id} asChild className={clsx("cursor-pointer", { "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400": isActive })}>
                <Link href={item.href} onClick={() => onItemClick?.()} className="flex items-center gap-2">
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-md bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-medium">
                      {item.badge}
                    </span>
                  )}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="space-y-1">
      {/* Group Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          "w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
          "text-muted-foreground hover:bg-accent hover:text-foreground",
          {
            "bg-accent/50 text-foreground": hasActiveChild,
          }
        )}
      >
        <div className="flex items-center gap-3">
          <group.icon className="w-5 h-5" />
          <span>{group.label}</span>
          {group.badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-yellow-500 text-black font-bold">
              {group.badge}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 transition-transform" />
        ) : (
          <ChevronRight className="w-4 h-4 transition-transform" />
        )}
      </button>

      {/* Group Items - Animated collapse via grid-template-rows (0fr→1fr):
          CONTENT-SIZED, so nothing can ever be clipped. This replaces two
          generations of max-height math — the fixed max-h-96 clipped
          Reports' tail, then the computed items×40px clipped again
          whenever a long label wrapped to two lines (e.g. "Stock
          Requests" under Inventory at certain widths). */}
      <div
        className={clsx(
          "ml-3 pl-3 border-l-2 border-border grid transition-[grid-template-rows,opacity] duration-200",
          isOpen
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="min-h-0 space-y-0.5 overflow-hidden">
          {visibleItems.map((item) => (
            <NavItem key={item.id} item={item} onItemClick={onItemClick} />
          ))}
        </div>
      </div>
    </div>
  );
};

const NavItem = ({ item, onItemClick, collapsed }) => {
  const pathname = usePathname();

  const isActive = (itemId, itemHref) => {
    if (itemId === "dashboard") {
      return pathname === "/dashboard";
    }
    return pathname === itemHref;
  };

  const active = isActive(item.id, item.href);

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={item.href}
            onClick={() => onItemClick?.()}
            className={clsx(
              "group w-full flex items-center justify-center p-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              {
                "bg-yellow-500 text-black shadow-sm hover:shadow-md": active,
                "text-muted-foreground hover:bg-accent hover:text-foreground": !active,
              }
            )}
          >
            <item.icon
              className={clsx("w-5 h-5 transition-transform group-hover:scale-110", {
                "text-black": active,
              })}
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={() => onItemClick?.()}
      className={clsx(
        "group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
        {
          "bg-yellow-500 text-black shadow-sm hover:shadow-md": active,
          "text-muted-foreground hover:bg-accent hover:text-foreground":
            !active,
        }
      )}
    >
      <item.icon
        className={clsx("w-4 h-4 transition-transform group-hover:scale-110", {
          "text-black": active,
        })}
      />
      <span
        className={clsx("font-medium", {
          "text-black": active,
        })}
      >
        {item.label}
      </span>
      {item.badge && (
        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-md bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-medium">
          {item.badge}
        </span>
      )}
    </Link>
  );
};

// ============================================
// MAIN SIDEBAR CONTENT
// ============================================
export const SidebarContentGrouped = ({ onItemClick, user, collapsed }) => {
  const navigationGroups = getNavigationGroups(user);
  const { setOpen: openCommandPalette } = useCommandPalette();

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col h-full bg-card overflow-hidden">
        {/* Logo */}
        <div className={clsx("border-b border-border", collapsed ? "p-3" : "p-4 md:p-5")}>
          <Link
            href="/dashboard"
            className="flex items-center group"
            onClick={() => onItemClick?.()}
          >
            {collapsed ? (
              <QaliSuiteIcon className="w-10 h-10 group-hover:scale-105 transition-transform" />
            ) : (
              <QaliSuiteMark size="md" subtitle="ERP System" className="group-hover:scale-[1.02] transition-transform" />
            )}
          </Link>
        </div>

        {/* Navigation */}
        <nav className={clsx("flex-1 space-y-1 overflow-y-auto", collapsed ? "p-2" : "p-3 md:p-4")}>
          {/* Search */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => openCommandPalette(true)}
                  className="group w-full flex items-center justify-center p-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200"
                >
                  <Search className="w-5 h-5 transition-transform group-hover:scale-110" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Search
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={() => openCommandPalette(true)}
              className="group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200"
            >
              <Search className="w-4 h-4 transition-transform group-hover:scale-110" />
              <span>Search</span>
            </button>
          )}

          {navigationGroups.map((navItem) => {
            if (navItem.hidden) return null;

            if (navItem.type === "single") {
              return (
                <NavItem
                  key={navItem.id}
                  item={navItem}
                  onItemClick={onItemClick}
                  collapsed={collapsed}
                />
              );
            }

            if (navItem.type === "group") {
              return (
                <NavGroup
                  key={navItem.id}
                  group={navItem}
                  user={user}
                  onItemClick={onItemClick}
                  collapsed={collapsed}
                />
              );
            }

            return null;
          })}
        </nav>

        {/* Clock In/Out */}
        <SidebarClockWidget collapsed={collapsed} />

        {/* Theme Toggle */}
        {!collapsed && <NextThemeToggler />}

        {/* User Profile */}
        <div className={clsx("border-t border-border bg-muted/30", collapsed ? "p-2" : "p-4")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="w-full flex items-center justify-center hover:bg-accent p-2 rounded-lg transition-all duration-200">
                      <Avatar className="w-8 h-8 ring-2 ring-border">
                        <AvatarImage
                          src={user?.image || "https://github.com/shadcn.png"}
                          alt={user?.name}
                        />
                        <AvatarFallback className="bg-yellow-500 text-black font-bold text-xs">
                          {getInitials(user?.name)}
                        </AvatarFallback>
                      </Avatar>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {user?.name}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <button className="w-full flex items-center gap-3 hover:bg-accent p-2.5 rounded-lg transition-all duration-200">
                  <Avatar className="w-10 h-10 ring-2 ring-border">
                    <AvatarImage
                      src={user?.image || "https://github.com/shadcn.png"}
                      alt={user?.name}
                    />
                    <AvatarFallback className="bg-yellow-500 text-black font-bold">
                      {getInitials(user?.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {user?.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user?.role || "User"}
                    </p>
                  </div>
                </button>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align={collapsed ? "start" : "start"}
              side={collapsed ? "right" : "top"}
              className="w-64 bg-card border-border"
              sideOffset={5}
            >
              <DropdownMenuLabel>
                <div className="flex items-center gap-3 pb-2">
                  <Avatar className="w-12 h-12 ring-2 ring-border">
                    <AvatarImage
                      src={user?.image || "https://github.com/shadcn.png"}
                      alt={user?.name}
                    />
                    <AvatarFallback className="bg-yellow-500 text-black font-bold">
                      {getInitials(user?.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {user?.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user?.email}
                    </p>
                    <p className="text-xs font-medium text-yellow-600 dark:text-yellow-500 truncate mt-1">
                      {user?.role || "User"}
                    </p>
                  </div>
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator className="bg-border" />

              <DropdownMenuItem
                asChild
                className="cursor-pointer focus:bg-accent focus:text-accent-foreground"
              >
                <Link href="/dashboard/profile" className="flex items-center">
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </Link>
              </DropdownMenuItem>

              <DropdownMenuItem
                asChild
                className="cursor-pointer focus:bg-accent focus:text-accent-foreground"
              >
                <Link href="/dashboard/settings" className="flex items-center">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator className="bg-border" />

              <DropdownMenuItem
                className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
                asChild
              >
                <form
                  action={async () => {
                    await logout();
                  }}
                  className="w-full"
                >
                  <button
                    className="w-full flex items-center text-left"
                    type="submit"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </button>
                </form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
};

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
import { logout } from "@/app/mongodb/actions";
import { NextThemeToggler } from "./NextThemeToggler";
import { useState, useEffect } from "react";

// ============================================
// NAV GROUP CONFIGURATION - GENERAL NAMING
// ============================================
// ============================================
// NAV GROUP CONFIGURATION - ERP FOCUSED
// ============================================
const getNavigationGroups = (user) => [
  // Dashboard (ungrouped)
  {
    type: "single",
    icon: LayoutDashboard,
    label: "Dashboard",
    id: "dashboard",
    href: "/dashboard",
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
    items: [
      {
        icon: Boxes,
        label: "Products",
        id: "products",
        href: "/dashboard/stocks",
        hidden: !["Admin", "Store Manager", "Accountant"].includes(user?.role),
      },
      {
        icon: FolderTree,
        label: "Categories",
        id: "categories",
        href: "/dashboard/categories",
        hidden: !["Admin", "Manager"].includes(user?.role),
      },
      {
        icon: Activity,
        label: "Stock Movements",
        id: "movements",
        href: "/dashboard/movements",
        // View only - auto-generated
      },
      {
        icon: FileText,
        label: "Stock Adjustments",
        id: "adjustments",
        href: "/dashboard/adjustments",
        hidden: !["Admin", "Store Manager", "Accountant"].includes(user?.role),
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
    label: "Sales",
    icon: ShoppingBag,
    id: "sales",
    defaultOpen: false,
    items: [
      {
        icon: FileText,
        label: "Quotes",
        id: "quotes",
        href: "/dashboard/quotes",
      },
      {
        icon: Receipt,
        label: "Invoices",
        id: "invoices",
        href: "/dashboard/invoices",
        hidden: !["Admin", "Accountant", "Sales"].includes(user?.role),
      },
      {
        icon: Receipt,
        label: "Credit Notes",
        id: "credit-notes",
        href: "/dashboard/credit-notes",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: FileText,
        label: "Delivery Notes",
        id: "dnotes",
        href: "/dashboard/dnotes",
        hidden: !["Admin", "Store Manager", "Sales"].includes(user?.role),
      },
      {
        icon: Users,
        label: "Customers",
        id: "customers",
        href: "/dashboard/customers",
        hidden: !["Admin", "Accountant", "Sales"].includes(user?.role),
      },
      {
        icon: CreditCard,
        label: "Payments Received",
        id: "payments-received",
        href: "/dashboard/payments/received",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: FileText,
        label: "Statements",
        id: "statements",
        href: "/dashboard/statements",
        hidden: !["Admin", "Accountant"].includes(user?.role),
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
    items: [
      {
        icon: FileText,
        label: "Purchase Orders",
        id: "purchase-orders",
        href: "/dashboard/purchase-orders",
        hidden: !["Admin", "Accountant", "Store Manager"].includes(user?.role),
      },
      {
        icon: Receipt,
        label: "Bills",
        id: "bills",
        href: "/dashboard/bills",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: Users,
        label: "Suppliers",
        id: "suppliers",
        href: "/dashboard/suppliers",
        hidden: !["Admin", "Accountant", "Store Manager"].includes(user?.role),
      },
      {
        icon: Wallet,
        label: "Payments Made",
        id: "payments-made",
        href: "/dashboard/payments/made",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: FileText,
        label: "Supplier Statements",
        id: "supplier-statements",
        href: "/dashboard/supplier-statements",
        hidden: !["Admin", "Accountant"].includes(user?.role),
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
        label: "My Claims", // ← Employee view
        id: "my-claims",
        href: "/dashboard/my-claims",
        // Everyone can see their own
      },

      {
        icon: Wallet,
        label: "All Claims", // ← Admin/Accountant view
        id: "all-claims",
        href: "/dashboard/claims",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: Receipt,
        label: "All Expenses",
        id: "expenses",
        href: "/dashboard/expenses",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: FileText,
        label: "Pending Approval",
        id: "expenses-pending",
        href: "/dashboard/expenses/pending",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: CreditCard,
        label: "Reimbursements",
        id: "reimbursements",
        href: "/dashboard/expenses/reimbursements",
        hidden: !["Admin", "Accountant"].includes(user?.role),
        badge: "Soon",
      },
    ],
  },

  // ============================================
  // FINANCE & ACCOUNTING
  // ============================================
  {
    type: "group",
    label: "Finance ",
    icon: DollarSign,
    id: "finance",
    defaultOpen: false,
    badge: "New",
    items: [
      {
        icon: Briefcase, // or Building2 or Users
        label: "Parties",
        id: "parties",
        href: "/dashboard/parties",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: BookOpen,
        label: "Chart of Accounts",
        id: "accounts",
        href: "/dashboard/accounts",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: FileSpreadsheet,
        label: "Journal Entries",
        id: "journal",
        href: "/dashboard/journal",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: ArrowLeftRight,
        label: "Bank Feed",
        id: "bank-feed",
        href: "/dashboard/banking",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: Calendar,
        label: "Fiscal Periods",
        id: "fiscal-periods",
        href: "/dashboard/fiscal-periods",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
    ],
  },

  // ============================================
  // TAX MANAGEMENT
  // ============================================
  {
    type: "group",
    label: "Tax Management",
    icon: FileText,
    id: "tax",
    defaultOpen: false,
    items: [
      {
        icon: Receipt,
        label: "VAT Returns",
        id: "vat-returns",
        href: "/dashboard/tax/vat",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: FileText,
        label: "WHT Reports",
        id: "wht-reports",
        href: "/dashboard/tax/wht",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: FileSpreadsheet,
        label: "Tax Transactions",
        id: "tax-transactions",
        href: "/dashboard/tax/transactions",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: Building2,
        label: "KRA Filings",
        id: "kra-filings",
        href: "/dashboard/tax/kra",
        hidden: user?.role !== "Admin",
        badge: "Soon",
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
    items: [
      // Financial Reports
      {
        icon: TrendingUp,
        label: "Profit & Loss",
        id: "profit-loss",
        href: "/dashboard/reports/profit-loss",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: Building2,
        label: "Balance Sheet",
        id: "balance-sheet",
        href: "/dashboard/reports/balance-sheet",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: Activity,
        label: "Cash Flow",
        id: "cash-flow",
        href: "/dashboard/reports/cash-flow",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: FileSpreadsheet,
        label: "Trial Balance",
        id: "trial-balance",
        href: "/dashboard/reports/trial-balance",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: BookOpen,
        label: "General Ledger",
        id: "general-ledger",
        href: "/dashboard/reports/general-ledger",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: Users,
        label: "AR Aging",
        id: "ar-aging",
        href: "/dashboard/reports/ar-aging",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: Building2,
        label: "AP Aging",
        id: "ap-aging",
        href: "/dashboard/reports/ap-aging",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },

      // Divider comment
      // Operational Reports
      {
        icon: Package,
        label: "Inventory Reports",
        id: "inventory-reports",
        href: "/dashboard/reports/inventory",
      },
      {
        icon: ShoppingBag,
        label: "Sales Reports",
        id: "sales-reports",
        href: "/dashboard/reports/sales",
        hidden: !["Admin", "Accountant", "Sales"].includes(user?.role),
      },
      {
        icon: ShoppingCart,
        label: "Purchase Reports",
        id: "purchase-reports",
        href: "/dashboard/reports/purchases",
        hidden: !["Admin", "Accountant"].includes(user?.role),
      },
      {
        icon: Users,
        label: "Customer Reports",
        id: "customer-reports",
        href: "/dashboard/reports/customers",
        hidden: !["Admin", "Accountant", "Sales"].includes(user?.role),
      },
    ],
  },

  // ============================================
  // PEOPLE & HR
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
  // SETTINGS (ungrouped)
  // ============================================
  {
    type: "single",
    icon: Settings,
    label: "Settings",
    id: "settings",
    href: "/dashboard/settings",
  },
];

// ============================================
// COMPONENTS
// ============================================

const NavGroup = ({ group, user, onItemClick }) => {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(group.defaultOpen ?? false);

  // Check if any child is active
  const hasActiveChild = group.items?.some((item) => {
    if (item.hidden) return false;
    return pathname.startsWith(item.href);
  });

  // Auto-open if has active child
  useEffect(() => {
    if (hasActiveChild) {
      setIsOpen(true);
    }
  }, [hasActiveChild]);

  const visibleItems = group.items?.filter((item) => !item.hidden) || [];

  if (visibleItems.length === 0) return null;

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

      {/* Group Items - Animated collapse */}
      <div
        className={clsx(
          "ml-3 pl-3 border-l-2 border-border space-y-0.5 overflow-hidden transition-all duration-200",
          {
            "max-h-0 opacity-0": !isOpen,
            "max-h-96 opacity-100": isOpen,
          }
        )}
      >
        {visibleItems.map((item) => (
          <NavItem key={item.id} item={item} onItemClick={onItemClick} />
        ))}
      </div>
    </div>
  );
};

const NavItem = ({ item, onItemClick }) => {
  const pathname = usePathname();

  const isActive = (itemId, itemHref) => {
    if (itemId === "dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(itemHref);
  };

  const active = isActive(item.id, item.href);

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
export const SidebarContentGrouped = ({ onItemClick, user }) => {
  const navigationGroups = getNavigationGroups(user);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Logo */}
      <div className="p-4 md:p-6 border-b border-border">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 group"
          onClick={() => onItemClick?.()}
        >
          <div className="w-10 h-10 bg-yellow-500 rounded-lg flex items-center justify-center font-bold text-black text-xl shadow-sm group-hover:shadow-md transition-shadow">
            Q
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold text-foreground">
              QaliSuite
            </span>
            <span className="text-xs text-muted-foreground">
              ERP System
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 md:p-4 space-y-1 overflow-y-auto">
        {navigationGroups.map((navItem) => {
          // Skip hidden items
          if (navItem.hidden) return null;

          // Single items (ungrouped)
          if (navItem.type === "single") {
            return (
              <NavItem
                key={navItem.id}
                item={navItem}
                onItemClick={onItemClick}
              />
            );
          }

          // Grouped items
          if (navItem.type === "group") {
            return (
              <NavGroup
                key={navItem.id}
                group={navItem}
                user={user}
                onItemClick={onItemClick}
              />
            );
          }

          return null;
        })}
      </nav>

      {/* Theme Toggle */}
      <NextThemeToggler />

      {/* User Profile */}
      <div className="p-4 border-t border-border bg-muted/30">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
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
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
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
  );
};

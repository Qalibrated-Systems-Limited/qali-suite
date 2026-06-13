"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Smart Create Button
 * Shows/hides and changes destination based on current page and user role
 */
export function CreateButton({ user }) {
  const pathname = usePathname();

  // ============================================
  // DEFINE ROUTES WITH PERMISSIONS
  // ============================================
  const createRoutes = {
    // Inventory
    "/dashboard/stocks": {
      href: "/dashboard/stocks/create",
      label: "Product",
      roles: ["SuperAdmin", "Admin", "Store Manager", "Accountant"],
    },
    // Categories
    "/dashboard/categories": {
      href: "/dashboard/categories/create",
      label: "Category",
      roles: ["SuperAdmin", "Admin", "Manager"],
    },
    "/dashboard/adjustments": {
      href: "/dashboard/adjustments/create",
      label: "Adjustment",
      roles: ["SuperAdmin", "Admin", "Store Manager", "Accountant"],
    },

    // Requests (everyone can create)
    "/dashboard/requests": {
      href: "/dashboard/requests/create",
      label: "Request",
      roles: ["*"], // Everyone
    },
    "/dashboard/checkout": {
      href: "/dashboard/requests/create",
      label: "Request",
      roles: ["*"],
    },

    // Sales
    "/dashboard/invoices": {
      href: "/dashboard/invoices/create",
      label: "Invoice",
      roles: ["SuperAdmin", "Admin", "Accountant", "Sales Manager"],
    },
    "/dashboard/quotes": {
      href: "/dashboard/quotes/create",
      label: "Quote",
      roles: ["SuperAdmin", "Admin", "Accountant", "Sales Manager"],
    },

    // Purchases
    "/dashboard/purchase-orders": {
      href: "/dashboard/purchase-orders/create",
      label: "Purchase Order",
      roles: ["SuperAdmin", "Admin", "Manager", "Accountant"],
    },
    "/dashboard/bills": {
      href: "/dashboard/bills/create",
      label: "Bill",
      roles: ["SuperAdmin", "Admin", "Accountant"],
    },

    // Parties
    "/dashboard/parties": {
      href: "/dashboard/parties/create",
      label: "Party",
      roles: ["SuperAdmin", "Admin", "Accountant"],
    },
    "/dashboard/customers": {
      href: "/dashboard/parties/create?type=customer",
      label: "Customer",
      roles: ["SuperAdmin", "Admin", "Accountant", "Sales Manager"],
    },
    "/dashboard/suppliers": {
      href: "/dashboard/parties/create?type=supplier",
      label: "Supplier",
      roles: ["SuperAdmin", "Admin", "Accountant", "Store Manager"],
    },

    // Expenses
    "/dashboard/expenses": {
      href: "/dashboard/expenses/create",
      label: "Expense",
      roles: ["SuperAdmin", "Admin", "Accountant"],
    },

    // Finance
    "/dashboard/accounts": {
      href: "/dashboard/accounts/create",
      label: "Account",
      roles: ["SuperAdmin", "Admin", "Accountant"],
    },
    "/dashboard/journal": {
      href: "/dashboard/journal/create",
      label: "Journal Entry",
      roles: ["SuperAdmin", "Admin", "Accountant"],
    },

    // Users
    "/dashboard/users": {
      href: "/dashboard/users/create",
      label: "User",
      roles: ["SuperAdmin", "Admin"],
    },
    "/dashboard/admin/companies": {
      href: "/dashboard/admin/companies/create",
      label: "Company",
      roles: ["SuperAdmin"],
    },

    "/dashboard/my-claims": {
      href: "/dashboard/claims/create",
      label: "Claim",
      roles: ["*"], // Everyone can create claims
    },
    "/dashboard/claims": {
      href: "/dashboard/claims/create",
      label: "Claim",
      roles: ["*"],
    },
    "/dashboard/claims/pending": {
      href: "/dashboard/claims/create",
      label: "Claim",
      roles: ["*"],
    },
    "/dashboard/claims/payments": {
      href: "/dashboard/claims/create",
      label: "Claim",
      roles: ["*"],
    },
  };

  // ============================================
  // CHECK IF BUTTON SHOULD SHOW
  // ============================================
  const currentRoute = createRoutes[pathname];

  // No route config = hide button
  if (!currentRoute) return null;

  // Check role permission
  const hasPermission =
    currentRoute.roles.includes("*") || currentRoute.roles.includes(user?.role);

  if (!hasPermission) return null;

  // ============================================
  // RENDER BUTTON
  // ============================================
  return (
    <>
      {/* Mobile: Icon only */}
      <Button
        size="icon"
        className="bg-yellow-500 text-black hover:bg-yellow-600 font-medium sm:hidden h-9 w-9"
        asChild
      >
        <Link href={currentRoute.href}>
          <Plus className="w-5 h-5" />
          <span className="sr-only">Create {currentRoute.label}</span>
        </Link>
      </Button>

      {/* Desktop: Full button with label */}
      <Button
        size="sm"
        className="hidden sm:inline-flex bg-yellow-500 text-black hover:bg-yellow-600 font-medium"
        asChild
      >
        <Link href={currentRoute.href}>
          <Plus className="w-4 h-4 mr-2" />
          Create {currentRoute.label}
        </Link>
      </Button>
    </>
  );
}

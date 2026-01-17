"use client";

import { Input } from "./ui/input";
import { SearchIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useDebouncedCallback } from "use-debounce";

export default function Search({ placeholder }) {
  const searchParams = useSearchParams();

  const { replace } = useRouter();
  const pathname = usePathname();

  const handleSearch = useDebouncedCallback((term) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");
    if (term) {
      params.set("query", term);
    } else {
      params.delete("query");
    }

    replace(`${pathname}?${params.toString()}`);
  }, 300);
  return (
    <div className="relative flex flex-1 flex-shrink-0 min-w-[200px]  w-full md:min-w-[500px]">
      <label htmlFor="search" className="sr-only">
        Search
      </label>
      <Input
        className="peer block w-full rounded-md border  py-[9px] pl-10 text-sm outline-2 placeholder:text-gray-500"
        placeholder={placeholder}
        defaultValue={searchParams.get("query")?.toString()}
        onChange={(e) => handleSearch(e.target.value)}
      />
      <SearchIcon className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
    </div>
  );
}

/**
 * Smart Search Component
 * Auto-configures placeholder and visibility based on current route
 */

/**
 * Smart Search Component
 * Always visible - auto-configures placeholder based on route
 * Defaults to stock search if no specific config
 */
export function SmartSearch() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { replace } = useRouter();
  const handleSearch = useDebouncedCallback((term) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1"); // Reset to first page

    if (term) {
      params.set("query", term);
    } else {
      params.delete("query");
    }

    replace(`${pathname}?${params.toString()}`);
  }, 300);

  // ============================================
  // SEARCH CONFIGURATION BY ROUTE
  // ============================================
  const searchConfig = {
    // Inventory
    "/dashboard/stocks": "Search products by name or SKU...",
    "/dashboard/movements": "Search stock movements...",
    "/dashboard/adjustments": "Search adjustments...",
    "/dashboard/checkout": "Search checkouts...",
    "/dashboard/requests": "Search requests...",
    // Claims
    "/dashboard/my-claims": "Search my claims...",
    "/dashboard/claims": "Search claims by employee or number...",
    "/dashboard/claims/pending": "Search pending claims...",
    "/dashboard/claims/payments": "Search claims pending payment...",

    // Sales
    "/dashboard/invoices": "Search invoices by number or customer...",
    "/dashboard/dnotes": "Search delivery notes...",

    // Parties
    "/dashboard/parties": "Search parties by name, email, or tax PIN...",
    "/dashboard/customers": "Search customers...",
    "/dashboard/suppliers": "Search suppliers...",

    // Purchases
    "/dashboard/bills": "Search bills...",

    // Expenses
    "/dashboard/expenses": "Search expenses...",

    // Finance
    "/dashboard/accounts": "Search accounts...",
    "/dashboard/journal-entries": "Search journal entries...",

    // Users
    "/dashboard/users": "Search users by name or email...",
  };

  // Get placeholder (defaults to stock search)
  const placeholder =
    searchConfig[pathname] || "Search products by name or SKU...";

  // ============================================
  // SEARCH HANDLER
  // ============================================

  // ============================================
  // RENDER - ALWAYS VISIBLE
  // ============================================
  return (
    <div className="relative flex flex-1 max-w-2xl">
      <label htmlFor="search" className="sr-only">
        Search
      </label>
      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        id="search"
        type="search"
        placeholder={placeholder}
        defaultValue={searchParams.get("query")?.toString()}
        onChange={(e) => handleSearch(e.target.value)}
        className="pl-10 pr-4 bg-background border-input text-foreground placeholder:text-muted-foreground focus-visible:ring-yellow-500 focus-visible:border-yellow-500 text-sm h-9 sm:h-10 w-full"
      />
    </div>
  );
}

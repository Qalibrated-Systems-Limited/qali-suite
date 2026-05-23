"use client";

import { Input } from "./ui/input";
import { SearchIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDebouncedCallback } from "use-debounce";
import { Button } from "./ui/button";
import { useCommandPalette } from "./command-palette-provider";

// ============================================
// SHARED: Search config by route
// ============================================
const SEARCH_CONFIG = {
  "/dashboard/stocks": "Search products by name or SKU...",
  "/dashboard/movements": "Search stock movements...",
  "/dashboard/adjustments": "Search adjustments...",
  "/dashboard/checkout": "Search checkouts...",
  "/dashboard/requests": "Search requests...",
  "/dashboard/my-claims": "Search my claims...",
  "/dashboard/claims": "Search claims by employee or number...",
  "/dashboard/claims/pending": "Search pending claims...",
  "/dashboard/claims/payments": "Search claims pending payment...",
  "/dashboard/invoices": "Search invoices by number or customer...",
  "/dashboard/parties": "Search parties by name, email, or tax PIN...",
  "/dashboard/customers": "Search customers...",
  "/dashboard/suppliers": "Search suppliers...",
  "/dashboard/bills": "Search bills...",
  "/dashboard/expenses": "Search expenses...",
  "/dashboard/accounts": "Search accounts...",
  "/dashboard/journal": "Search journal entries...",
  "/dashboard/users": "Search users by name or email...",
  "/dashboard/quotes": "Search quotes...",
};

// ============================================
// LEGACY: Page-level search (used by individual pages)
// ============================================
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
    <div className="relative flex flex-1 shrink-0 min-w-[200px] w-full md:min-w-[500px]">
      <label htmlFor="search" className="sr-only">
        Search
      </label>
      <Input
        className="peer block w-full rounded-md border py-[9px] pl-10 text-sm outline-2 placeholder:text-gray-500"
        placeholder={placeholder}
        defaultValue={searchParams.get("query")?.toString()}
        onChange={(e) => handleSearch(e.target.value)}
      />
      <SearchIcon className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
    </div>
  );
}

// ============================================
// MOBILE SEARCH: Opens command palette
// ============================================
export function MobileSearch() {
  const { setOpen } = useCommandPalette();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="sm:hidden text-muted-foreground hover:text-foreground hover:bg-accent h-8 w-8"
      onClick={() => setOpen(true)}
    >
      <SearchIcon className="w-4 h-4" />
      <span className="sr-only">Search</span>
    </Button>
  );
}

// ============================================
// DESKTOP SEARCH: Opens command palette
// ============================================
export function DesktopSearch() {
  const { setOpen } = useCommandPalette();
  const pathname = usePathname();
  const placeholder = SEARCH_CONFIG[pathname] || "Search...";

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="relative hidden sm:flex items-center flex-1 max-w-xl h-9 rounded-full bg-muted/50 border border-transparent hover:border-input text-sm transition-colors cursor-pointer"
    >
      <SearchIcon className="ml-3 w-4 h-4 text-muted-foreground shrink-0" />
      <span className="ml-2 text-muted-foreground truncate">{placeholder}</span>
      <kbd className="ml-auto mr-2 pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground shrink-0">
        <span className="text-xs">⌘</span>K
      </kbd>
    </button>
  );
}

// Keep SmartSearch for backwards compatibility
export function SmartSearch() {
  return (
    <>
      <MobileSearch />
      <DesktopSearch />
    </>
  );
}

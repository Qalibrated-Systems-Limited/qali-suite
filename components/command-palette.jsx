"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Boxes,
  Receipt,
  FileText,
  Users,
  Building2,
  Plus,
  Wallet,
  BookOpen,
  List,
  FileSpreadsheet,
  Settings,
  TrendingUp,
  Package,
  Loader2,
  ArrowRight,
  ClipboardList,
  HandCoins,
} from "lucide-react";
import { useDebouncedCallback } from "use-debounce";
import { globalSearch } from "@/app/mongodb/actions/global-search-action";

// ============================================
// QUICK NAVIGATION ITEMS
// ============================================
const PAGES = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Products", href: "/dashboard/stocks", icon: Boxes },
  { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
  { label: "Quotes", href: "/dashboard/quotes", icon: FileText },
  { label: "Bills", href: "/dashboard/bills", icon: Receipt },
  { label: "Customers", href: "/dashboard/customers", icon: Users },
  { label: "Suppliers", href: "/dashboard/suppliers", icon: Building2 },
  { label: "Delivery Notes", href: "/dashboard/dnotes", icon: Package },
  { label: "Purchase Orders", href: "/dashboard/purchase-orders", icon: FileText },
  { label: "Stock Requests", href: "/dashboard/requests", icon: List },
  { label: "Claims", href: "/dashboard/claims", icon: HandCoins },
  { label: "My Claims", href: "/dashboard/my-claims", icon: ClipboardList },
  { label: "Expenses", href: "/dashboard/expenses", icon: Wallet },
  { label: "Chart of Accounts", href: "/dashboard/accounts", icon: BookOpen },
  { label: "Journal Entries", href: "/dashboard/journal", icon: FileSpreadsheet },
  { label: "Reports", href: "/dashboard/reports/profit-loss", icon: TrendingUp },
  { label: "Users", href: "/dashboard/users", icon: Users },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

const ACTIONS = [
  { label: "Create Invoice", href: "/dashboard/invoices/create", icon: Plus },
  { label: "Create Quote", href: "/dashboard/quotes/create", icon: Plus },
  { label: "Create Bill", href: "/dashboard/bills/create", icon: Plus },
  { label: "Create Product", href: "/dashboard/stocks/create", icon: Plus },
  { label: "Create Expense", href: "/dashboard/expenses/create", icon: Plus },
  { label: "Create Request", href: "/dashboard/requests/create", icon: Plus },
  { label: "Request Advance", href: "/dashboard/claims/create/advance", icon: Plus },
  { label: "Submit Reimbursement", href: "/dashboard/claims/create/reimbursement", icon: Plus },
];

// ============================================
// FORMAT HELPERS
// ============================================
function formatCurrency(amount) {
  if (!amount && amount !== 0) return "";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
  }).format(amount);
}

function statusBadge(status) {
  const colors = {
    draft: "text-yellow-600",
    sent: "text-blue-600",
    completed: "text-green-600",
    accepted: "text-green-600",
    cancelled: "text-red-600",
    expired: "text-muted-foreground",
    approved: "text-green-600",
    pending: "text-yellow-600",
    paid: "text-green-600",
    partial: "text-orange-600",
    submitted: "text-blue-600",
    rejected: "text-red-600",
    fulfilled: "text-green-600",
    partially_fulfilled: "text-orange-600",
    pending_return: "text-yellow-600",
    pending_payment: "text-yellow-600",
    closed: "text-muted-foreground",
  };
  return colors[status] || "text-muted-foreground";
}

const CLAIM_TYPE_LABELS = {
  advance_request: "Advance",
  advance_return: "Settlement",
  reimbursement: "Reimbursement",
};

// ============================================
// COMMAND PALETTE
// ============================================
export function CommandPalette({ open, setOpen }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [isPending, startTransition] = useTransition();

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const down = (e) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setOpen]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(null);
    }
  }, [open]);

  // Debounced search
  const debouncedSearch = useDebouncedCallback((term) => {
    if (!term || term.trim().length < 2) {
      setResults(null);
      return;
    }
    startTransition(async () => {
      try {
        const data = await globalSearch(term);
        setResults(data);
      } catch {
        setResults(null);
      }
    });
  }, 300);

  const handleValueChange = useCallback(
    (value) => {
      setQuery(value);
      debouncedSearch(value);
    },
    [debouncedSearch]
  );

  const handleSelect = useCallback(
    (href) => {
      setOpen(false);
      router.push(href);
    },
    [setOpen, router]
  );

  const queryTrimmed = query.trim().toLowerCase();
  const hasQuery = queryTrimmed.length >= 2;
  const hasResults =
    results &&
    (results.products?.length > 0 ||
      results.invoices?.length > 0 ||
      results.quotes?.length > 0 ||
      results.bills?.length > 0 ||
      results.customers?.length > 0 ||
      results.suppliers?.length > 0 ||
      results.claims?.length > 0 ||
      results.stockRequests?.length > 0);

  // Manual filtering for pages & actions (since shouldFilter={false})
  const filteredPages = queryTrimmed
    ? PAGES.filter((p) => p.label.toLowerCase().includes(queryTrimmed))
    : PAGES;
  const filteredActions = queryTrimmed
    ? ACTIONS.filter((a) => a.label.toLowerCase().includes(queryTrimmed))
    : ACTIONS;
  const hasNavItems = filteredPages.length > 0 || filteredActions.length > 0;

  // Show "no results" only when both nav filtering AND server search return nothing
  const showEmpty =
    hasQuery && !isPending && !hasResults && !hasNavItems;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      shouldFilter={false}
      title="Search"
      description="Search anything or navigate quickly"
    >
      <CommandInput
        placeholder="Search products, invoices, claims, requests..."
        value={query}
        onValueChange={handleValueChange}
      />
      <CommandList className="max-h-[400px]">
        {/* Loading indicator */}
        {isPending && hasQuery && (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Searching...
          </div>
        )}

        {/* No results at all */}
        {showEmpty && (
          <CommandEmpty>No results found for &ldquo;{query}&rdquo;</CommandEmpty>
        )}

        {/* ============================================ */}
        {/* SERVER SEARCH RESULTS */}
        {/* ============================================ */}
        {hasQuery && !isPending && hasResults && (
          <>
            {/* Products */}
            {results.products?.length > 0 && (
              <CommandGroup heading="Products">
                {results.products.map((p) => (
                  <CommandItem
                    key={`product-${p._id}`}
                    value={`product-${p._id}`}
                    onSelect={() => handleSelect(`/dashboard/stocks/${p._id}`)}
                  >
                    <Boxes className="mr-2 h-4 w-4 text-blue-500" />
                    <div className="flex flex-1 items-center justify-between min-w-0">
                      <div className="min-w-0">
                        <span className="font-medium">{p.name}</span>
                        {p.SKU && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {p.SKU}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground ml-2 shrink-0">
                        Qty: {p.inventory?.quantityOnHand ?? 0}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Invoices */}
            {results.invoices?.length > 0 && (
              <CommandGroup heading="Invoices">
                {results.invoices.map((inv) => (
                  <CommandItem
                    key={`inv-${inv._id}`}
                    value={`inv-${inv._id}`}
                    onSelect={() =>
                      handleSelect(`/dashboard/invoices/${inv._id}`)
                    }
                  >
                    <Receipt className="mr-2 h-4 w-4 text-green-500" />
                    <div className="flex flex-1 items-center justify-between min-w-0">
                      <div className="min-w-0">
                        <span className="font-medium">
                          {inv.invoiceNumber}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground truncate">
                          {inv.customer?.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className={`text-xs ${statusBadge(inv.status)}`}>
                          {inv.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatCurrency(inv.total)}
                        </span>
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Quotes */}
            {results.quotes?.length > 0 && (
              <CommandGroup heading="Quotes">
                {results.quotes.map((q) => (
                  <CommandItem
                    key={`qt-${q._id}`}
                    value={`qt-${q._id}`}
                    onSelect={() =>
                      handleSelect(`/dashboard/quotes/${q._id}`)
                    }
                  >
                    <FileText className="mr-2 h-4 w-4 text-purple-500" />
                    <div className="flex flex-1 items-center justify-between min-w-0">
                      <div className="min-w-0">
                        <span className="font-medium">{q.quoteNumber}</span>
                        <span className="ml-2 text-xs text-muted-foreground truncate">
                          {q.customer?.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className={`text-xs ${statusBadge(q.status)}`}>
                          {q.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatCurrency(q.total)}
                        </span>
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Bills */}
            {results.bills?.length > 0 && (
              <CommandGroup heading="Bills">
                {results.bills.map((b) => (
                  <CommandItem
                    key={`bill-${b._id}`}
                    value={`bill-${b._id}`}
                    onSelect={() =>
                      handleSelect(`/dashboard/bills/${b._id}`)
                    }
                  >
                    <Receipt className="mr-2 h-4 w-4 text-orange-500" />
                    <div className="flex flex-1 items-center justify-between min-w-0">
                      <div className="min-w-0">
                        <span className="font-medium">{b.billNumber}</span>
                        <span className="ml-2 text-xs text-muted-foreground truncate">
                          {b.supplier?.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className={`text-xs ${statusBadge(b.status)}`}>
                          {b.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatCurrency(b.amounts?.total)}
                        </span>
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Customers */}
            {results.customers?.length > 0 && (
              <CommandGroup heading="Customers">
                {results.customers.map((c) => (
                  <CommandItem
                    key={`cust-${c._id}`}
                    value={`cust-${c._id}`}
                    onSelect={() =>
                      handleSelect(`/dashboard/parties/${c._id}`)
                    }
                  >
                    <Users className="mr-2 h-4 w-4 text-cyan-500" />
                    <div className="min-w-0">
                      <span className="font-medium">
                        {c.displayName || c.name}
                      </span>
                      {c.email && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {c.email}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Suppliers */}
            {results.suppliers?.length > 0 && (
              <CommandGroup heading="Suppliers">
                {results.suppliers.map((s) => (
                  <CommandItem
                    key={`sup-${s._id}`}
                    value={`sup-${s._id}`}
                    onSelect={() =>
                      handleSelect(`/dashboard/parties/${s._id}`)
                    }
                  >
                    <Building2 className="mr-2 h-4 w-4 text-amber-500" />
                    <div className="min-w-0">
                      <span className="font-medium">
                        {s.displayName || s.name}
                      </span>
                      {s.email && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {s.email}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Claims */}
            {results.claims?.length > 0 && (
              <CommandGroup heading="Claims">
                {results.claims.map((c) => (
                  <CommandItem
                    key={`claim-${c._id}`}
                    value={`claim-${c._id}`}
                    onSelect={() =>
                      handleSelect(`/dashboard/claims/${c._id}`)
                    }
                  >
                    <HandCoins className="mr-2 h-4 w-4 text-teal-500" />
                    <div className="flex flex-1 items-center justify-between min-w-0">
                      <div className="min-w-0">
                        <span className="font-medium">{c.claimNumber}</span>
                        <span className="ml-2 text-xs text-muted-foreground truncate">
                          {c.employee?.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {CLAIM_TYPE_LABELS[c.claimType] || c.claimType}
                        </span>
                        <span className={`text-xs ${statusBadge(c.status)}`}>
                          {c.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatCurrency(c.totalAmount)}
                        </span>
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Stock Requests */}
            {results.stockRequests?.length > 0 && (
              <CommandGroup heading="Stock Requests">
                {results.stockRequests.map((r) => (
                  <CommandItem
                    key={`req-${r._id}`}
                    value={`req-${r._id}`}
                    onSelect={() =>
                      handleSelect(`/dashboard/requests/${r._id}`)
                    }
                  >
                    <List className="mr-2 h-4 w-4 text-indigo-500" />
                    <div className="flex flex-1 items-center justify-between min-w-0">
                      <div className="min-w-0">
                        <span className="font-medium">{r.requestNumber}</span>
                        <span className="ml-2 text-xs text-muted-foreground truncate">
                          {r.requester?.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        {r.requester?.department && (
                          <span className="text-xs text-muted-foreground">
                            {r.requester.department}
                          </span>
                        )}
                        <span className={`text-xs ${statusBadge(r.status)}`}>
                          {r.status?.replace("_", " ")}
                        </span>
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}

        {/* ============================================ */}
        {/* PAGES & QUICK ACTIONS (always shown, filtered) */}
        {/* ============================================ */}
        {filteredPages.length > 0 && (
          <>
            {hasQuery && hasResults && <CommandSeparator />}
            <CommandGroup heading="Pages">
              {filteredPages.map((item) => (
                <CommandItem
                  key={item.href}
                  value={item.label}
                  onSelect={() => handleSelect(item.href)}
                >
                  <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{item.label}</span>
                  <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground" />
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {filteredActions.length > 0 && (
          <>
            {(filteredPages.length > 0 || (hasQuery && hasResults)) && (
              <CommandSeparator />
            )}
            <CommandGroup heading="Quick Actions">
              {filteredActions.map((item) => (
                <CommandItem
                  key={item.href}
                  value={item.label}
                  onSelect={() => handleSelect(item.href)}
                >
                  <item.icon className="mr-2 h-4 w-4 text-yellow-500" />
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

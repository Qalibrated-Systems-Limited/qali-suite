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
  FolderKanban,
  Briefcase,
  CalendarDays,
  Clock,
  Banknote,
  Landmark,
  PiggyBank,
  ScrollText,
  Scale,
  CheckSquare,
} from "lucide-react";
import { useDebouncedCallback } from "use-debounce";
import { globalSearch } from "@/app/mongodb/actions/global-search-action";

// ============================================
// QUICK NAVIGATION ITEMS
// ============================================
// Each page has an optional `category` so the palette can group results
// (defaults to "General"). Aliases let users find pages with synonyms — e.g.
// typing "PAYE" surfaces Payroll, "P&L" surfaces the Profit & Loss report.
const PAGES = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Executive Overview", href: "/dashboard/executive", icon: TrendingUp, aliases: ["ceo", "exec", "overview", "snapshot"] },
  { label: "Approvals", href: "/dashboard/approvals", icon: CheckSquare },

  // ── Inventory ──────────────────────────────────────
  { label: "Products", href: "/dashboard/stocks", icon: Boxes, category: "Inventory" },
  { label: "Categories", href: "/dashboard/categories", icon: List, category: "Inventory" },
  { label: "Stock Movements", href: "/dashboard/movements", icon: List, category: "Inventory", aliases: ["movements", "stock history", "ledger"] },
  { label: "Stock Adjustments", href: "/dashboard/adjustments", icon: ClipboardList, category: "Inventory", aliases: ["adjustment", "writeoff", "physical count"] },
  { label: "Item Checkouts", href: "/dashboard/checkout", icon: Package, category: "Inventory", aliases: ["checkout", "borrow", "issue"] },
  { label: "Stock Requests", href: "/dashboard/requests", icon: List, category: "Inventory" },
  { label: "Goods Receipt Notes", href: "/dashboard/grn", icon: ClipboardList, category: "Inventory", aliases: ["grn", "receiving", "inspection"] },
  { label: "Nonconformance Register", href: "/dashboard/ncr", icon: ClipboardList, category: "Inventory", aliases: ["ncr", "discrepancy", "nonconformance", "quality"] },

  // ── CRM ────────────────────────────────────────────
  { label: "Leads", href: "/dashboard/leads", icon: Users, category: "CRM", aliases: ["prospect", "prospects", "lead"] },
  { label: "Pipeline", href: "/dashboard/opportunities", icon: Briefcase, category: "CRM", aliases: ["opportunities", "opportunity", "deals", "sales pipeline"] },

  // ── Sales ──────────────────────────────────────────
  { label: "Quotes", href: "/dashboard/quotes", icon: FileText, category: "Sales" },
  { label: "Sales Orders", href: "/dashboard/sales-orders", icon: ClipboardList, category: "Sales", aliases: ["so", "orders", "backlog", "order backlog"] },
  { label: "Invoices", href: "/dashboard/invoices", icon: Receipt, category: "Sales" },
  { label: "Credit Notes", href: "/dashboard/credit-notes", icon: Receipt, category: "Sales", aliases: ["refund", "return"] },
  { label: "Customers", href: "/dashboard/customers", icon: Users, category: "Sales" },

  // ── Purchases ──────────────────────────────────────
  { label: "Purchase Orders", href: "/dashboard/purchase-orders", icon: FileText, category: "Purchases", aliases: ["po"] },
  { label: "Bills", href: "/dashboard/bills", icon: Receipt, category: "Purchases" },
  { label: "Suppliers", href: "/dashboard/suppliers", icon: Building2, category: "Purchases", aliases: ["vendors"] },

  // ── Expenses ───────────────────────────────────────
  { label: "Employee Expenses", href: "/dashboard/claims", icon: HandCoins, category: "Expenses", aliases: ["claims", "advances", "reimbursements"] },
  { label: "My Expenses", href: "/dashboard/my-claims", icon: ClipboardList, category: "Expenses", aliases: ["my claims"] },
  { label: "Operating Expenses", href: "/dashboard/expenses", icon: Wallet, category: "Expenses", aliases: ["expenses", "utilities", "rent"] },

  // ── Projects ───────────────────────────────────────
  { label: "Projects", href: "/dashboard/projects", icon: FolderKanban },

  // ── Admin ──────────────────────────────────────────
  { label: "Users", href: "/dashboard/users", icon: Users, category: "Admin" },
  { label: "Companies", href: "/dashboard/admin/companies", icon: Building2, category: "Admin", aliases: ["tenants"] },
  { label: "Company Settings", href: "/dashboard/company", icon: Building2, category: "Admin" },
  { label: "Integrations", href: "/dashboard/integrations", icon: Settings, category: "Admin" },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, category: "Admin" },

  // ── HR ─────────────────────────────────────────────
  { label: "HR Overview", href: "/dashboard/hr", icon: Briefcase, category: "HR" },
  { label: "Employees", href: "/dashboard/hr/employees", icon: Users, category: "HR", aliases: ["staff", "people", "workforce"] },
  { label: "Departments", href: "/dashboard/hr/departments", icon: Building2, category: "HR" },
  { label: "Payroll", href: "/dashboard/hr/payroll", icon: Banknote, category: "HR", aliases: ["paye", "salary", "salaries", "payslip", "shif", "nssf"] },
  { label: "My Payslips", href: "/dashboard/hr/my-payslips", icon: ScrollText, category: "HR", aliases: ["payslip"] },
  { label: "Leave Requests", href: "/dashboard/hr/leave", icon: CalendarDays, category: "HR" },
  { label: "My Leave", href: "/dashboard/hr/my-leave", icon: CalendarDays, category: "HR" },
  { label: "Leave Calendar", href: "/dashboard/hr/leave/calendar", icon: CalendarDays, category: "HR" },
  { label: "Leave Types", href: "/dashboard/hr/leave-types", icon: CalendarDays, category: "HR", aliases: ["entitlement", "days", "config"] },
  { label: "Attendance", href: "/dashboard/hr/attendance", icon: Clock, category: "HR", aliases: ["clock-in", "timesheet"] },
  { label: "My Attendance", href: "/dashboard/hr/my-attendance", icon: Clock, category: "HR" },
  { label: "Loans", href: "/dashboard/hr/loans", icon: HandCoins, category: "HR", aliases: ["advance", "salary advance"] },

  // ── Finance / Accounting ───────────────────────────
  { label: "Parties", href: "/dashboard/parties", icon: Briefcase, category: "Finance", aliases: ["contacts", "people", "customer supplier"] },
  { label: "Chart of Accounts", href: "/dashboard/accounts", icon: BookOpen, category: "Finance", aliases: ["coa"] },
  { label: "Journal Entries", href: "/dashboard/journal", icon: FileSpreadsheet, category: "Finance", aliases: ["je", "manual entry"] },
  { label: "Banking", href: "/dashboard/banking", icon: Landmark, category: "Finance", aliases: ["bank feed", "reconcile"] },
  { label: "Bank Statement Upload", href: "/dashboard/banking/upload", icon: Landmark, category: "Finance", aliases: ["import statement"] },
  { label: "Unallocated Transactions", href: "/dashboard/banking/unallocated", icon: Landmark, category: "Finance" },
  { label: "Fixed Assets", href: "/dashboard/assets", icon: Package, category: "Finance", aliases: ["capital", "depreciation"] },
  { label: "Payments", href: "/dashboard/payments", icon: Wallet, category: "Finance" },
  { label: "Payments Received", href: "/dashboard/payments/received", icon: Wallet, category: "Finance", aliases: ["customer payments", "ar"] },
  { label: "Payments Made", href: "/dashboard/payments/made", icon: Wallet, category: "Finance", aliases: ["supplier payments", "ap"] },
  { label: "Customer Statements", href: "/dashboard/statements", icon: FileText, category: "Finance" },
  { label: "Supplier Statements", href: "/dashboard/supplier-statements", icon: FileText, category: "Finance" },
  { label: "Fiscal Periods", href: "/dashboard/settings/fiscal-periods", icon: CalendarDays, category: "Finance", aliases: ["close period"] },

  // ── Tax ────────────────────────────────────────────
  { label: "VAT Returns", href: "/dashboard/tax/vat", icon: PiggyBank, category: "Tax", aliases: ["vat", "value added tax"] },
  { label: "Withholding Tax (WHT)", href: "/dashboard/tax/wht", icon: PiggyBank, category: "Tax", aliases: ["wht"] },
  { label: "Tax Transactions", href: "/dashboard/tax/transactions", icon: PiggyBank, category: "Tax" },
  { label: "KRA Filings", href: "/dashboard/tax/kra", icon: PiggyBank, category: "Tax", aliases: ["paye", "kra"] },

  // ── Reports ────────────────────────────────────────
  { label: "Profit & Loss", href: "/dashboard/reports/profit-loss", icon: TrendingUp, category: "Reports", aliases: ["p&l", "income statement"] },
  { label: "Balance Sheet", href: "/dashboard/reports/balance-sheet", icon: Scale, category: "Reports" },
  { label: "Cash Flow", href: "/dashboard/reports/cash-flow", icon: TrendingUp, category: "Reports" },
  { label: "Trial Balance", href: "/dashboard/reports/trial-balance", icon: Scale, category: "Reports" },
  { label: "General Ledger", href: "/dashboard/reports/general-ledger", icon: BookOpen, category: "Reports", aliases: ["gl"] },
  { label: "AR Aging", href: "/dashboard/reports/ar-aging", icon: TrendingUp, category: "Reports", aliases: ["receivables aging"] },
  { label: "AP Aging", href: "/dashboard/reports/ap-aging", icon: TrendingUp, category: "Reports", aliases: ["payables aging"] },
  { label: "Sales Report", href: "/dashboard/reports/sales", icon: TrendingUp, category: "Reports", aliases: ["sales by customer", "top customers", "sales by product"] },
  { label: "Sales by Rep", href: "/dashboard/reports/sales-by-rep", icon: TrendingUp, category: "Reports", aliases: ["leaderboard", "salesperson", "rep performance", "commission"] },
  { label: "Purchase Report", href: "/dashboard/reports/purchases", icon: TrendingUp, category: "Reports", aliases: ["spend by supplier", "top suppliers"] },
  { label: "Inventory Report", href: "/dashboard/reports/inventory", icon: Package, category: "Reports" },
  { label: "Asset Rollforward", href: "/dashboard/reports/asset-rollforward", icon: Package, category: "Reports" },
];

const ACTIONS = [
  { label: "New Lead", href: "/dashboard/leads", icon: Plus },
  { label: "Create Invoice", href: "/dashboard/invoices/create", icon: Plus },
  { label: "Create Quote", href: "/dashboard/quotes/create", icon: Plus },
  { label: "Create Bill", href: "/dashboard/bills/create", icon: Plus },
  { label: "Create Product", href: "/dashboard/stocks/create", icon: Plus },
  { label: "Create Expense", href: "/dashboard/expenses/create", icon: Plus },
  { label: "Create Request", href: "/dashboard/requests/create", icon: Plus },
  { label: "Request Advance", href: "/dashboard/claims/create/advance", icon: Plus },
  { label: "Submit Reimbursement", href: "/dashboard/claims/create/reimbursement", icon: Plus },
  { label: "Create Project", href: "/dashboard/projects/create", icon: Plus },
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
      results.stockRequests?.length > 0 ||
      results.projects?.length > 0);

  // Manual filtering for pages & actions (since shouldFilter={false}).
  // Match against label OR any alias (so "PAYE" finds Payroll, "P&L" finds
  // Profit & Loss, etc.).
  const matchesQuery = (item) => {
    if (!queryTrimmed) return true;
    if (item.label.toLowerCase().includes(queryTrimmed)) return true;
    if (item.aliases?.some((a) => a.toLowerCase().includes(queryTrimmed))) return true;
    return false;
  };
  const filteredPages = PAGES.filter(matchesQuery);
  const filteredActions = ACTIONS.filter(matchesQuery);
  const hasNavItems = filteredPages.length > 0 || filteredActions.length > 0;

  // Group filtered pages by category (defaults to "General") and preserve
  // the original order within each group.
  const pagesByCategory = filteredPages.reduce((acc, item) => {
    const cat = item.category || "General";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});
  // Category render order. Anything not listed falls back to the end so
  // a newly added category still appears (avoids the silent-drop bug
  // where palette entries were invisible until added here).
  const CATEGORY_ORDER = [
    "General",
    "Inventory",
    "CRM",
    "Sales",
    "Purchases",
    "Expenses",
    "Finance",
    "Tax",
    "HR",
    "Reports",
    "Admin",
  ];
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => pagesByCategory[c]),
    ...Object.keys(pagesByCategory).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

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

            {/* Projects */}
            {results.projects?.length > 0 && (
              <CommandGroup heading="Projects">
                {results.projects.map((p) => (
                  <CommandItem
                    key={`prj-${p._id}`}
                    value={`prj-${p._id}`}
                    onSelect={() =>
                      handleSelect(`/dashboard/projects/${p._id}`)
                    }
                  >
                    <FolderKanban className="mr-2 h-4 w-4 text-violet-500" />
                    <div className="flex flex-1 items-center justify-between min-w-0">
                      <div className="min-w-0">
                        <span className="font-medium">{p.projectNumber}</span>
                        <span className="ml-2 text-xs text-muted-foreground truncate">
                          {p.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className={`text-xs ${statusBadge(p.status)}`}>
                          {p.status}
                        </span>
                        {p.client?.name && (
                          <span className="text-xs text-muted-foreground">
                            {p.client.name}
                          </span>
                        )}
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
        {orderedCategories.map((category, idx) => (
          <CommandGroup
            key={category}
            heading={category === "General" ? "Pages" : category}
          >
            {idx === 0 && hasQuery && hasResults && <CommandSeparator />}
            {pagesByCategory[category].map((item) => (
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
        ))}

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

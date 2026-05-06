"use client";

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Download,
  FileText,
  Filter,
  Receipt,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ============================================
// FORMATTERS
// ============================================
const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
};

const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatPeriodLabel = (period) => {
  if (!period) return "All Periods";
  const [year, month] = period.split("-");
  const date = new Date(year, month - 1);
  return date.toLocaleDateString("en-KE", { year: "numeric", month: "short" });
};

// ============================================
// TAX TYPE CONFIGURATION (Kenya Compliance)
// ============================================
const taxTypeConfig = {
  // VAT
  vat_output: {
    label: "VAT Output",
    shortLabel: "VAT Out",
    color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    group: "VAT",
  },
  vat_input: {
    label: "VAT Input",
    shortLabel: "VAT In",
    color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    group: "VAT",
  },
  // Withholding
  wht: {
    label: "WHT Paid",
    shortLabel: "WHT",
    color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    group: "Withholding",
  },
  wht_received: {
    label: "WHT Received",
    shortLabel: "WHT Rcvd",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    group: "Withholding",
  },
  // Payroll
  paye: {
    label: "PAYE",
    shortLabel: "PAYE",
    color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    group: "Payroll",
  },
  nssf: {
    label: "NSSF",
    shortLabel: "NSSF",
    color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
    group: "Payroll",
  },
  shif: {
    label: "SHIF",
    shortLabel: "SHIF",
    color: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
    group: "Payroll",
  },
  nhif: {
    label: "NHIF (legacy)",
    shortLabel: "NHIF",
    color: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
    group: "Payroll",
  },
  housing_levy: {
    label: "Housing Levy",
    shortLabel: "H. Levy",
    color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
    group: "Payroll",
  },
  // Other
  excise_duty: {
    label: "Excise Duty",
    shortLabel: "Excise",
    color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    group: "Other",
  },
  dst: {
    label: "Digital Service Tax",
    shortLabel: "DST",
    color: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
    group: "Other",
  },
  turnover_tax: {
    label: "Turnover Tax",
    shortLabel: "TOT",
    color: "bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200",
    group: "Other",
  },
  advance_tax: {
    label: "Advance Tax",
    shortLabel: "Adv Tax",
    color: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
    group: "Other",
  },
  cgt: {
    label: "Capital Gains Tax",
    shortLabel: "CGT",
    color: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900 dark:text-fuchsia-200",
    group: "Other",
  },
  other: {
    label: "Other Tax",
    shortLabel: "Other",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
    group: "Other",
  },
};

const getTaxTypeInfo = (type) => {
  return taxTypeConfig[type] || { label: type, shortLabel: type, color: "bg-gray-100 text-gray-800", group: "Other" };
};

// Group tax types for organized dropdown
const taxTypeGroups = [
  {
    label: "VAT",
    types: ["vat_output", "vat_input"],
  },
  {
    label: "Withholding",
    types: ["wht", "wht_received"],
  },
  {
    label: "Payroll",
    types: ["paye", "nssf", "shif", "housing_levy"],
  },
  {
    label: "Other",
    types: ["excise_duty", "dst", "turnover_tax", "advance_tax", "cgt", "other"],
  },
];

// ============================================
// MAIN COMPONENT
// ============================================
export default function TaxTransactionsClient({
  transactions,
  pagination,
  periods,
  initialFilters,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState(initialFilters);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [searchInput, setSearchInput] = useState(initialFilters.search || "");

  // Build URL params from filters
  const buildParams = useCallback((newFilters) => {
    const params = new URLSearchParams();
    if (newFilters.taxType && newFilters.taxType !== "all") params.set("taxType", newFilters.taxType);
    if (newFilters.filed && newFilters.filed !== "all") params.set("filed", newFilters.filed);
    if (newFilters.period && newFilters.period !== "all") params.set("period", newFilters.period);
    if (newFilters.remitted && newFilters.remitted !== "all") params.set("remitted", newFilters.remitted);
    if (newFilters.source && newFilters.source !== "all") params.set("source", newFilters.source);
    if (newFilters.startDate) params.set("startDate", newFilters.startDate);
    if (newFilters.endDate) params.set("endDate", newFilters.endDate);
    if (newFilters.search) params.set("search", newFilters.search);
    params.set("page", "1");
    return params;
  }, []);

  const applyFilters = useCallback((newFilters) => {
    const params = buildParams(newFilters);
    router.push(`/dashboard/tax/transactions?${params.toString()}`);
  }, [router, buildParams]);

  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    applyFilters(newFilters);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    handleFilterChange("search", searchInput);
  };

  const clearFilters = () => {
    const emptyFilters = {
      taxType: "",
      filed: "",
      period: "",
      remitted: "",
      source: "",
      startDate: "",
      endDate: "",
      search: "",
    };
    setFilters(emptyFilters);
    setSearchInput("");
    router.push("/dashboard/tax/transactions");
  };

  const goToPage = (page) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", page.toString());
    router.push(`/dashboard/tax/transactions?${params.toString()}`);
  };

  const handleExport = () => {
    // Build export URL with current filters
    const params = buildParams(filters);
    params.set("export", "csv");
    // TODO: Implement export endpoint
    alert("Export functionality coming soon");
  };

  const hasActiveFilters = Object.entries(filters).some(
    ([key, value]) => value && value !== "" && value !== "all"
  );

  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => value && value !== "" && value !== "all"
  ).length;

  return (
    <div className="space-y-4">
      {/* Export Button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      </div>

      {/* Filters Card */}
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          {/* Primary Filters Row */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1 min-w-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search party, transaction no..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </form>

            {/* Tax Type */}
            <Select
              value={filters.taxType || "all"}
              onValueChange={(v) => handleFilterChange("taxType", v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-full sm:w-[160px] h-9 text-sm">
                <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Tax Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tax Types</SelectItem>
                {taxTypeGroups.map((group) => (
                  <div key={group.label}>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                      {group.label}
                    </div>
                    {group.types.map((type) => (
                      <SelectItem key={type} value={type}>
                        {taxTypeConfig[type]?.label || type}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>

            {/* Period */}
            <Select
              value={filters.period || "all"}
              onValueChange={(v) => handleFilterChange("period", v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-full sm:w-[140px] h-9 text-sm">
                <Calendar className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Periods</SelectItem>
                {periods?.map((period) => (
                  <SelectItem key={period} value={period}>
                    {formatPeriodLabel(period)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Filed Status */}
            <Select
              value={filters.filed || "all"}
              onValueChange={(v) => handleFilterChange("filed", v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-full sm:w-[130px] h-9 text-sm">
                <FileText className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="true">Filed</SelectItem>
                <SelectItem value="false">Unfiled</SelectItem>
              </SelectContent>
            </Select>

            {/* Advanced Toggle & Clear */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="h-9 whitespace-nowrap"
              >
                <SlidersHorizontal className="w-4 h-4 mr-1" />
                More
                {showAdvanced ? (
                  <ChevronUp className="w-3 h-3 ml-1" />
                ) : (
                  <ChevronDown className="w-3 h-3 ml-1" />
                )}
              </Button>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-9"
                >
                  <X className="w-4 h-4 mr-1" />
                  Clear ({activeFilterCount})
                </Button>
              )}
            </div>
          </div>

          {/* Advanced Filters */}
          {showAdvanced && (
            <div className="pt-3 border-t space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Date Range */}
                <div className="space-y-1.5">
                  <Label htmlFor="startDate" className="text-xs text-muted-foreground">
                    From Date
                  </Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={filters.startDate || ""}
                    onChange={(e) => handleFilterChange("startDate", e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endDate" className="text-xs text-muted-foreground">
                    To Date
                  </Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={filters.endDate || ""}
                    onChange={(e) => handleFilterChange("endDate", e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>

                {/* Remittance Status (for WHT) */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Remittance (WHT)
                  </Label>
                  <Select
                    value={filters.remitted || "all"}
                    onValueChange={(v) => handleFilterChange("remitted", v === "all" ? "" : v)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="true">Remitted</SelectItem>
                      <SelectItem value="false">Unremitted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Source Document */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Source Document
                  </Label>
                  <Select
                    value={filters.source || "all"}
                    onValueChange={(v) => handleFilterChange("source", v === "all" ? "" : v)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="All Sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      <SelectItem value="invoice">Invoices</SelectItem>
                      <SelectItem value="bill">Bills</SelectItem>
                      <SelectItem value="journal_entry">Journals</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transactions List */}
      <Card>
        <CardContent className="p-0">
          {transactions && transactions.length > 0 ? (
            <>
              {/* Mobile Card View */}
              <div className="md:hidden divide-y">
                {transactions.map((txn) => {
                  const typeInfo = getTaxTypeInfo(txn.taxType);
                  return (
                    <div
                      key={txn._id}
                      className="p-3 hover:bg-muted/30 active:bg-muted/50"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm truncate pr-2">
                          {txn.transactionNumber}
                        </span>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${typeInfo.color}`}
                        >
                          {typeInfo.shortLabel}
                        </Badge>
                      </div>

                      <p className="text-xs text-muted-foreground mb-2 truncate">
                        {txn.party?.name || "Unknown Party"}
                        {txn.party?.taxPin && (
                          <span className="ml-2 opacity-70">({txn.party.taxPin})</span>
                        )}
                      </p>

                      <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                        <div>
                          <span className="text-muted-foreground block">Date</span>
                          <span className="font-medium">{formatDate(txn.transactionDate)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Base</span>
                          <span className="font-medium tabular-nums">{formatCurrency(txn.baseAmount)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Tax</span>
                          <span className="font-medium tabular-nums text-purple-600">
                            {formatCurrency(txn.taxAmount)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {txn.kraTracking?.filed ? (
                            <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Filed
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                              <Clock className="w-3 h-3 mr-1" />
                              Pending
                            </Badge>
                          )}
                          {txn.taxType === "wht" && txn.kraTracking?.remitted && (
                            <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-800">
                              Remitted
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {txn.taxCode} @ {txn.taxRate}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Transaction
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Type
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Party
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Date
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        Base Amount
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        Tax Amount
                      </th>
                      <th className="text-center p-3 font-medium text-muted-foreground">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((txn) => {
                      const typeInfo = getTaxTypeInfo(txn.taxType);
                      return (
                        <tr key={txn._id} className="border-b hover:bg-muted/30">
                          <td className="p-3">
                            <p className="font-medium">{txn.transactionNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              {txn.taxCode} @ {txn.taxRate}%
                            </p>
                          </td>
                          <td className="p-3">
                            <Badge variant="secondary" className={typeInfo.color}>
                              {typeInfo.label}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <p className="truncate max-w-[200px]">{txn.party?.name || "-"}</p>
                            {txn.party?.taxPin && (
                              <p className="text-xs text-muted-foreground">{txn.party.taxPin}</p>
                            )}
                          </td>
                          <td className="p-3">{formatDate(txn.transactionDate)}</td>
                          <td className="p-3 text-right tabular-nums">
                            {formatCurrency(txn.baseAmount)}
                          </td>
                          <td className="p-3 text-right tabular-nums font-medium text-purple-600">
                            {formatCurrency(txn.taxAmount)}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              {txn.kraTracking?.filed ? (
                                <Badge
                                  variant="secondary"
                                  className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Filed
                                </Badge>
                              ) : (
                                <Badge
                                  variant="secondary"
                                  className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                                >
                                  <Clock className="w-3 h-3 mr-1" />
                                  Pending
                                </Badge>
                              )}
                              {txn.taxType === "wht" && (
                                <Badge
                                  variant="secondary"
                                  className={
                                    txn.kraTracking?.remitted
                                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                      : "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                                  }
                                >
                                  {txn.kraTracking?.remitted ? "Remitted" : "Unremitted"}
                                </Badge>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between p-3 border-t">
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Showing {((pagination.page - 1) * 20) + 1} - {Math.min(pagination.page * 20, pagination.total)} of {pagination.total}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(pagination.page - 1)}
                      disabled={pagination.page <= 1}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="px-2 text-sm text-muted-foreground">
                      {pagination.page} / {pagination.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(pagination.page + 1)}
                      disabled={pagination.page >= pagination.totalPages}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="p-8 text-center">
              <Receipt className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No tax transactions found</p>
              <p className="text-xs text-muted-foreground mt-1">
                {hasActiveFilters
                  ? "Try adjusting your filters"
                  : "Tax transactions are created when invoices and bills are completed"}
              </p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={clearFilters} className="mt-3">
                  Clear Filters
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Receipt,
  Clock,
  CheckCircle2,
  XCircle,
  Wallet,
  TrendingUp,
  AlertCircle,
  Calendar,
  MoreHorizontal,
  Eye,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
  }).format(amount || 0);
};

const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const statusConfig = {
  draft:    { label: "Draft",    variant: "secondary",    icon: Receipt },
  posted:   { label: "Posted",   variant: "success",      icon: CheckCircle2 },
  paid:     { label: "Paid",     variant: "default",      icon: Wallet },
  void:     { label: "Void",     variant: "destructive",  icon: XCircle },
  // Legacy statuses — still shown for old data
  pending:  { label: "Pending",  variant: "warning",      icon: Clock },
  approved: { label: "Approved", variant: "success",      icon: CheckCircle2 },
  rejected: { label: "Rejected", variant: "destructive",  icon: XCircle },
};

const categoryLabels = {
  utilities: "Utilities",
  rent: "Rent & Lease",
  salaries: "Salaries",
  transport: "Transport",
  office_supplies: "Office Supplies",
  insurance: "Insurance",
  maintenance: "Maintenance",
  marketing: "Marketing",
  legal_professional: "Legal/Professional",
  bank_charges: "Bank Charges",
  depreciation: "Depreciation",
  meals_entertainment: "Meals & Entertainment",
  telecommunications: "Telecom",
  training: "Training",
  other: "Other",
};

export default function ExpenseList({
  expenses,
  pagination,
  summary,
  categories,
  filters,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(filters.search || "");

  const updateFilters = (key, value) => {
    const params = new URLSearchParams(searchParams);
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page"); // Reset to page 1
    router.push(`/dashboard/expenses?${params.toString()}`);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    updateFilters("search", search);
  };

  const goToPage = (page) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", page.toString());
    router.push(`/dashboard/expenses?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">This Month</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {formatCurrency(summary?.totals?.totalAmount)}
            </p>
            <p className="text-xs text-muted-foreground">
              {summary?.totals?.count || 0} expenses
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Posted</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {formatCurrency(
                (summary?.byStatus?.posted?.total || 0) +
                (summary?.byStatus?.approved?.total || 0) +
                (summary?.byStatus?.pending?.total || 0)
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {(summary?.byStatus?.posted?.count || 0) +
               (summary?.byStatus?.approved?.count || 0) +
               (summary?.byStatus?.pending?.count || 0)}{" "}
              expenses
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              <span className="text-sm text-muted-foreground">Unpaid</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {formatCurrency(
                (summary?.byStatus?.posted?.total || 0) +
                (summary?.byStatus?.approved?.total || 0)
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {(summary?.byStatus?.posted?.count || 0) +
               (summary?.byStatus?.approved?.count || 0)}{" "}
              awaiting payment
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-purple-500" />
              <span className="text-sm text-muted-foreground">Paid</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {formatCurrency(summary?.byStatus?.paid?.total || 0)}
            </p>
            <p className="text-xs text-muted-foreground">
              {summary?.byStatus?.paid?.count || 0} completed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search expenses..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </form>

            {/* Status Filter */}
            <Select
              value={filters.status || "all"}
              onValueChange={(value) => updateFilters("status", value)}
            >
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="posted">Posted</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="void">Void</SelectItem>
              </SelectContent>
            </Select>

            {/* Category Filter */}
            <Select
              value={filters.category || "all"}
              onValueChange={(value) => updateFilters("category", value)}
            >
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Expense Table */}
      <Card>
        <CardContent className="p-0">
          {expenses.length > 0 ? (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Number</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((expense) => {
                      const StatusIcon = statusConfig[expense.status]?.icon || Receipt;
                      return (
                        <TableRow key={expense._id}>
                          <TableCell className="text-sm">
                            {formatDate(expense.expenseDate)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            <Link
                              href={`/dashboard/expenses/${expense._id}`}
                              className="hover:underline text-primary"
                            >
                              {expense.expenseNumber}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {categoryLabels[expense.category] || expense.category}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[150px] truncate">
                            {expense.vendor?.name || "-"}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                            {expense.description}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatCurrency(expense.total)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusConfig[expense.status]?.variant}>
                              <StatusIcon className="w-3 h-3 mr-1" />
                              {statusConfig[expense.status]?.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={`/dashboard/expenses/${expense._id}`}>
                                    <Eye className="w-4 h-4 mr-2" />
                                    View Details
                                  </Link>
                                </DropdownMenuItem>
                                {expense.status === "draft" && (
                                  <DropdownMenuItem asChild>
                                    <Link href={`/dashboard/expenses/${expense._id}/edit`}>
                                      Edit
                                    </Link>
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden divide-y">
                {expenses.map((expense) => {
                  const StatusIcon = statusConfig[expense.status]?.icon || Receipt;
                  return (
                    <Link
                      key={expense._id}
                      href={`/dashboard/expenses/${expense._id}`}
                      className="block p-4 hover:bg-muted/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-sm font-medium">
                              {expense.expenseNumber}
                            </span>
                            <Badge variant={statusConfig[expense.status]?.variant} className="text-xs">
                              {statusConfig[expense.status]?.label}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {expense.vendor?.name} - {expense.description}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            {formatDate(expense.expenseDate)}
                            <Badge variant="outline" className="text-xs ml-2">
                              {categoryLabels[expense.category]}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold tabular-nums">
                            {formatCurrency(expense.total)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="p-8 text-center">
              <Receipt className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium mb-1">No expenses found</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {filters.search || filters.status || filters.category
                  ? "Try adjusting your filters"
                  : "Create your first expense to get started"}
              </p>
              <Button asChild>
                <Link href="/dashboard/expenses/create">Create Expense</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(pagination.page - 1) * 20 + 1} to{" "}
            {Math.min(pagination.page * 20, pagination.total)} of {pagination.total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page === 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

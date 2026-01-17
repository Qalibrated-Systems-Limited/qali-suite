"use client";

import { useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  ChevronDown,
  Eye,
  Edit,
  Power,
  PowerOff,
  RefreshCw,
  MoreVertical,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  activateAccount,
  deactivateAccount,
  calculateAccountBalance,
} from "@/app/mongodb/actions/account-actions";
import { toast } from "sonner";

const ACCOUNT_TYPE_LABELS = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expenses",
};

const ACCOUNT_TYPE_COLORS = {
  asset: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  liability: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  equity:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  revenue:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  expense:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

export default function AccountsListClient({ accountsGrouped }) {
  const router = useRouter();
  const [expandedAccounts, setExpandedAccounts] = useState(new Set());
  const [pendingActions, setPendingActions] = useState(new Set());

  // Toggle account expansion
  const toggleExpand = (accountId) => {
    const newExpanded = new Set(expandedAccounts);
    if (newExpanded.has(accountId)) {
      newExpanded.delete(accountId);
    } else {
      newExpanded.add(accountId);
    }
    setExpandedAccounts(newExpanded);
  };

  // Handle activate/deactivate
  const handleToggleStatus = async (accountId, isActive) => {
    setPendingActions((prev) => new Set(prev).add(accountId));

    try {
      const result = isActive
        ? await deactivateAccount(accountId)
        : await activateAccount(accountId);

      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to update status");
      }
    } finally {
      setPendingActions((prev) => {
        const newSet = new Set(prev);
        newSet.delete(accountId);
        return newSet;
      });
    }
  };

  // Handle recalculate balance
  const handleRecalculate = async (accountId) => {
    setPendingActions((prev) => new Set(prev).add(accountId));

    try {
      const result = await calculateAccountBalance(accountId);

      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.errors?._form?.[0] || "Failed to calculate balance");
      }
    } finally {
      setPendingActions((prev) => {
        const newSet = new Set(prev);
        newSet.delete(accountId);
        return newSet;
      });
    }
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 2,
    }).format(amount || 0);
  };

  // Render account row
  const renderAccountRow = (account, level = 0) => {
    const hasChildren = account.children && account.children.length > 0;
    const isExpanded = expandedAccounts.has(account._id);
    const isPending = pendingActions.has(account._id);

    return (
      <Fragment key={account._id}>
        <TableRow className="hover:bg-muted/50">
          {/* Account Code & Name */}
          <TableCell>
            <div
              className="flex items-center gap-2"
              style={{ paddingLeft: `${level * 24}px` }}
            >
              {hasChildren ? (
                <button
                  onClick={() => toggleExpand(account._id)}
                  className="hover:bg-accent p-1 rounded"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
              ) : (
                <div className="w-6" />
              )}
              <div>
                <div className="font-mono text-sm font-medium">
                  {account.accountCode}
                </div>
                <div className="text-sm text-foreground">
                  {account.accountName}
                </div>
              </div>
            </div>
          </TableCell>

          {/* Sub Type */}
          <TableCell>
            <Badge variant="outline" className="text-xs">
              {account.subType}
            </Badge>
          </TableCell>

          {/* Can Post */}
          <TableCell className="text-center">
            {account.canPost ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                Yes
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Header
              </Badge>
            )}
          </TableCell>

          {/* Balance */}
          <TableCell className="text-right font-mono">
            {account.canPost ? formatCurrency(account.cachedBalance) : "—"}
          </TableCell>

          {/* Status */}
          <TableCell className="text-center">
            <Badge
              variant="outline"
              className={
                account.isActive
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
              }
            >
              {account.isActive ? "Active" : "Inactive"}
            </Badge>
          </TableCell>

          {/* Actions */}
          <TableCell className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" disabled={isPending}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link
                    href={`/dashboard/accounts/${account._id}`}
                    className="cursor-pointer"
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    View Details
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <Link
                    href={`/dashboard/accounts/${account._id}/edit`}
                    className="cursor-pointer"
                  >
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </Link>
                </DropdownMenuItem>

                {account.canPost && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleRecalculate(account._id)}
                      disabled={isPending}
                      className="cursor-pointer"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Recalculate Balance
                    </DropdownMenuItem>
                  </>
                )}

                {!account.systemAccount && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() =>
                        handleToggleStatus(account._id, account.isActive)
                      }
                      disabled={isPending}
                      className={
                        account.isActive
                          ? "text-orange-600 cursor-pointer"
                          : "text-green-600 cursor-pointer"
                      }
                    >
                      {account.isActive ? (
                        <>
                          <PowerOff className="mr-2 h-4 w-4" />
                          Deactivate
                        </>
                      ) : (
                        <>
                          <Power className="mr-2 h-4 w-4" />
                          Activate
                        </>
                      )}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>

        {/* Render children if expanded */}
        {hasChildren &&
          isExpanded &&
          account.children.map((child) => renderAccountRow(child, level + 1))}
      </Fragment>
    );
  };

  return (
    <div className="space-y-4">
      {/* Account Types Accordion */}
      <Accordion
        type="multiple"
        defaultValue={["asset", "liability", "revenue"]}
        className="space-y-4"
      >
        {Object.entries(accountsGrouped).map(([type, accounts]) => (
          <AccordionItem key={type} value={type} className="border rounded-lg">
            <AccordionTrigger className="px-4 hover:bg-muted/50">
              <div className="flex items-center gap-3">
                <Badge className={ACCOUNT_TYPE_COLORS[type]}>
                  {ACCOUNT_TYPE_LABELS[type]}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {accounts.length} accounts
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Sub Type</TableHead>
                        <TableHead className="text-center">Postable</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="h-24 text-center text-muted-foreground"
                          >
                            No accounts found
                          </TableCell>
                        </TableRow>
                      ) : (
                        accounts.map((account) => renderAccountRow(account))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

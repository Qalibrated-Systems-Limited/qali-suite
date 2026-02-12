import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Edit,
  Power,
  PowerOff,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Calendar,
  User,
  Hash,
  FileText,
  Shield,
  Activity,
} from "lucide-react";
import { getAccountById } from "@/app/mongodb/queries/accountQueries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AccountActionButtons,
  RecalculateBalanceButton,
} from "../components/actionButtons";
import { auth } from "@/auth";
import { serializeBsonType } from "@/lib/utils";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const account = await getAccountById(id);

  return {
    title: account
      ? `${account.accountCode} - ${account.accountName} | Accounts`
      : "Account Details",
  };
}

export default async function AccountDetailPage({ params }) {
  const { id } = await params;
  const session = await auth();
  const { user } = session;

  // Fetch account with transactions
  const account = await getAccountById(id, true);

  if (!account) {
    notFound();
  }

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 2,
    }).format(amount || 0);
  };

  // Format date
  const formatDate = (date) => {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Get account type color
  const getTypeColor = (type) => {
    const colors = {
      asset:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
      liability:
        "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
      equity:
        "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800",
      revenue:
        "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
      expense:
        "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800",
    };
    return colors[type] || "";
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 w-full sm:w-auto">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href="/dashboard/accounts">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-bold font-mono break-all">
                {account.accountCode}
              </h1>
              <Badge
                variant="outline"
                className={getTypeColor(account.accountType)}
              >
                {account.accountType}
              </Badge>
              <Badge
                variant="outline"
                className={
                  account.isActive
                    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800"
                    : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800"
                }
              >
                {account.isActive ? "Active" : "Inactive"}
              </Badge>
              {account.systemAccount && (
                <Badge
                  variant="outline"
                  className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800"
                >
                  <Shield className="w-3 h-3 mr-1" />
                  System
                </Badge>
              )}
            </div>
            <p className="text-lg sm:text-xl text-foreground mt-1 break-words">
              {account.accountName}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {account.canPost && <RecalculateBalanceButton account={account} />}

          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/accounts/${account._id}/edit`}>
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Link>
          </Button>

          <AccountActionButtons account={account} />
        </div>
      </div>

      {/* System Account Alert */}
      {account.systemAccount && (
        <Alert className="border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/10">
          <Shield className="h-4 w-4 text-yellow-800 dark:text-yellow-400" />
          <AlertDescription className="text-yellow-800 dark:text-yellow-400">
            <strong>System Account:</strong>{" "}
            {account.systemAccount.replace(/_/g, " ").toUpperCase()} - This
            account is used by the system for automated operations.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Main Content - Left Side */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          {/* Balance Card (if postable) */}
          {account.canPost && (
            <Card className="border-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Current Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">
                      Account Balance
                    </p>
                    <div className="flex items-baseline gap-3">
                      <p
                        className={`text-3xl sm:text-4xl font-bold ${
                          account.cachedBalance > 0
                            ? "text-green-600 dark:text-green-400"
                            : account.cachedBalance < 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(Math.abs(account.cachedBalance))}
                      </p>
                      {account.cachedBalance !== 0 && (
                        <div className="flex items-center gap-1">
                          {account.cachedBalance > 0 ? (
                            <>
                              <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />
                              <span className="text-sm font-medium text-green-600 dark:text-green-400">
                                Debit
                              </span>
                            </>
                          ) : (
                            <>
                              <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />
                              <span className="text-sm font-medium text-red-600 dark:text-red-400">
                                Credit
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {account.balanceUpdatedAt && (
                    <div className="pt-3 border-t border-border">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Last updated: {formatDate(account.balanceUpdatedAt)}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Account Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Account Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Hash className="w-4 h-4" />
                    Account Code
                  </p>
                  <p className="font-mono font-semibold text-lg">
                    {account.accountCode}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Account Type</p>
                  <Badge
                    variant="outline"
                    className={getTypeColor(account.accountType)}
                  >
                    {account.accountType.charAt(0).toUpperCase() +
                      account.accountType.slice(1)}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Sub Type</p>
                  <Badge variant="outline" className="capitalize">
                    {account.subType.replace(/_/g, " ")}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Can Post Transactions
                  </p>
                  {account.canPost ? (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      Yes
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      No (Header Account)
                    </Badge>
                  )}
                </div>
              </div>

              {account.description && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Description</p>
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {account.description}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Recent Transactions */}
          {account.canPost &&
            account.recentTransactions &&
            account.recentTransactions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Recent Transactions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {account.recentTransactions.map((txn, index) => (
                      <div
                        key={index}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-muted/50 hover:bg-muted transition"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm break-words">
                            {txn.description}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span className="font-mono">{txn.entryNumber}</span>
                            <span>•</span>
                            <span>{formatDate(txn.date)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          {txn.debit > 0 && (
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">
                                Debit
                              </p>
                              <p className="font-semibold text-green-600 dark:text-green-400">
                                {formatCurrency(txn.debit)}
                              </p>
                            </div>
                          )}
                          {txn.credit > 0 && (
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">
                                Credit
                              </p>
                              <p className="font-semibold text-red-600 dark:text-red-400">
                                {formatCurrency(txn.credit)}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}

                    <Button variant="outline" className="w-full" asChild>
                      <Link href={`/dashboard/accounts/${account._id}/ledger`}>
                        View Full Ledger
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
        </div>

        {/* Sidebar - Right Side */}
        <div className="space-y-4 sm:space-y-6">
          {/* Quick Stats */}
          {account.canPost && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Balance Type
                  </span>
                  <Badge variant="outline">
                    {["asset", "expense"].includes(account.accountType)
                      ? "Debit"
                      : "Credit"}
                  </Badge>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
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
                </div>

                {account.systemAccount && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        System Type
                      </span>
                      <Badge variant="outline" className="capitalize text-xs">
                        {account.systemAccount.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground flex items-center gap-1 mb-1">
                  <User className="w-3 h-3" />
                  Created By
                </p>
                <p className="font-medium break-words">
                  {account.createdBy?.name || "System"}
                </p>
              </div>

              <Separator />

              <div>
                <p className="text-muted-foreground flex items-center gap-1 mb-1">
                  <Calendar className="w-3 h-3" />
                  Created
                </p>
                <p className="font-medium">{formatDate(account.createdAt)}</p>
              </div>

              <Separator />

              <div>
                <p className="text-muted-foreground mb-1">Last Modified By</p>
                <p className="font-medium break-words">
                  {account.lastModifiedBy?.name || "—"}
                </p>
              </div>

              <Separator />

              <div>
                <p className="text-muted-foreground mb-1">Last Updated</p>
                <p className="font-medium">{formatDate(account.updatedAt)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                asChild
              >
                <Link href={`/dashboard/accounts/${account._id}/edit`}>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Account
                </Link>
              </Button>

              {account.canPost && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  asChild
                >
                  <Link href={`/dashboard/accounts/${account._id}/ledger`}>
                    <FileText className="w-4 h-4 mr-2" />
                    View Ledger
                  </Link>
                </Button>
              )}

              <Button
                variant="outline"
                className="w-full justify-start"
                asChild
              >
                <Link href="/dashboard/accounts">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Accounts
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

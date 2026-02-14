import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AccountStatsCards,
  AccountStatsSkeleton,
  AccountsListServer,
  AccountsListSkeleton,
} from "../components/AccountServerComponents";

export const metadata = {
  title: "Chart of Accounts | ERP System",
  description: "Manage your chart of accounts",
};

export default async function AccountsPage() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Chart of Accounts</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">
            Manage your accounting structure
          </p>
        </div>
        <Button asChild className="sm:w-auto">
          <Link href="/dashboard/accounts/create">
            <Plus className="w-4 h-4 mr-2" />
            New Account
          </Link>
        </Button>
      </div>

      {/* Stats Cards - Stream independently */}
      <Suspense fallback={<AccountStatsSkeleton />}>
        <AccountStatsCards />
      </Suspense>

      {/* Accounts List - Stream independently */}
      <Suspense fallback={<AccountsListSkeleton />}>
        <AccountsListServer />
      </Suspense>
    </div>
  );
}

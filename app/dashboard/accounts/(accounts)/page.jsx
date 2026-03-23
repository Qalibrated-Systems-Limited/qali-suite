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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Chart of Accounts</h1>
        <Button asChild size="sm">
          <Link href="/dashboard/accounts/create">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
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

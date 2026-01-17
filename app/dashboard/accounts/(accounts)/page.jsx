import { auth } from "@/auth";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import AccountsListClient from "../components/accountsList";
import { getAccountsGrouped } from "@/app/mongodb/queries/accountQueries";

export const metadata = {
  title: "Chart of Accounts | ERP System",
  description: "Manage your chart of accounts",
};

export default async function AccountsPage() {
  const session = await auth();
  const { user } = session;

  // Fetch accounts grouped by type
  const accountsGrouped = await getAccountsGrouped();

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
      </div>

      {/* Accounts List */}
      <AccountsListClient accountsGrouped={accountsGrouped} />
    </div>
  );
}

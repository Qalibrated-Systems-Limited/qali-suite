import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import AccountForm from "../components/accountForm";

import { getAccountFormOptionsPg } from "@/app/db/actions/account-actions";

export const metadata = {
  title: "Create Account | ERP System",
};

export default async function CreateAccountPage() {
  // Both reads were Mongo, and both failed silently — see the action's header
  // for what each one cost. Tenant scoping is RLS's now, not a filter this
  // page has to remember.
  const { headerAccounts: serializedHeaders, nextCodes } =
    await getAccountFormOptionsPg();

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/accounts">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Create Account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Add a new account to your chart of accounts
          </p>
        </div>
      </div>

      {/* Form */}
      <AccountForm headerAccounts={serializedHeaders} nextCodes={nextCodes} />
    </div>
  );
}

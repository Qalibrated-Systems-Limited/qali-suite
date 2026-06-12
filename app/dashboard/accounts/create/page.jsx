import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import AccountForm from "../components/accountForm";

import connectDB from "@/app/config/dbConnect";
import Account from "@/app/models/account";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { suggestCodes } from "@/lib/coa-codes";

export const metadata = {
  title: "Create Account | ERP System",
};

export default async function CreateAccountPage() {
  await connectDB();
  const { companyId } = await getTenantContext();

  // Fetch ONLY header accounts (can't post, used as parents) - tenant-scoped
  const headerAccounts = await Account.find({
    companyId,
    subType: "header",
    isActive: true,
  })
    .sort({ accountCode: 1 })
    .select("_id accountCode accountName accountType")
    .lean();

  // All codes (cheap projection) → per-range next-code suggestions so the
  // form can auto-fill instead of making users guess.
  const allCodes = await Account.find({ companyId })
    .select("accountCode")
    .lean();
  const nextCodes = suggestCodes(allCodes.map((a) => a.accountCode));

  // Serialize for client
  const serializedHeaders = headerAccounts.map((acc) => ({
    _id: acc._id.toString(),
    accountCode: acc.accountCode,
    accountName: acc.accountName,
    accountType: acc.accountType,
  }));

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
          <h1 className="text-2xl sm:text-3xl font-bold">Create Account</h1>
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

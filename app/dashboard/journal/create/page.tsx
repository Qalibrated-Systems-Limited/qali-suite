import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import Account from "@/app/models/account";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import JournalEntryForm from "./JournalEntryForm";

export const metadata = {
  title: "Create Journal Entry | ERP",
  description: "Create a manual journal entry",
};

// Entry types for manual journal entries
const MANUAL_ENTRY_TYPES = [
  { value: "adjustment", label: "General Adjustment" },
  { value: "opening_balance", label: "Opening Balance" },
  { value: "closing", label: "Closing Entry" },
  { value: "transfer", label: "Transfer" },
  { value: "contra", label: "Contra Entry" },
  { value: "bank_entry", label: "Bank Entry" },
  { value: "cash_entry", label: "Cash Entry" },
  { value: "accrual", label: "Accrual" },
  { value: "depreciation", label: "Depreciation" },
  { value: "write_off", label: "Write Off" },
  { value: "revaluation", label: "Revaluation" },
  { value: "other", label: "Other" },
];

async function getFormData() {
  await dbConnect();
  const { companyId } = await getTenantContext();

  // Fetch all postable accounts grouped by type
  const accounts = await Account.find({
    companyId,
    isActive: { $ne: false },
    canPost: true,
  })
    .select("_id accountCode accountName accountType subType")
    .sort({ accountType: 1, accountCode: 1 })
    .lean();

  return {
    accounts: accounts.map((a) => ({
      _id: a._id.toString(),
      accountCode: a.accountCode,
      accountName: a.accountName,
      accountType: a.accountType,
      subType: a.subType || "",
    })),
    entryTypes: MANUAL_ENTRY_TYPES,
  };
}

export default async function CreateJournalEntryPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Check role
  if (!FINANCE_WRITE_ROLES.includes(session.user.role as string)) {
    redirect("/dashboard/journal");
  }

  const { accounts, entryTypes } = await getFormData();

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="border-b bg-card/50">
        <div className="container max-w-4xl py-4 sm:py-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="h-8 w-8 shrink-0"
            >
              <Link href="/dashboard/journal">
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Back to journal</span>
              </Link>
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Create Journal Entry
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Create a manual double-entry journal entry
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 container max-w-4xl py-6 sm:py-8">
        <JournalEntryForm accounts={accounts} entryTypes={entryTypes} />
      </div>
    </div>
  );
}

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import JournalEntryForm from "./JournalEntryForm";
import {
  createManualJournalEntry,
  getPostableAccountsPg,
} from "@/app/db/actions/journal-actions";

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

export default async function CreateJournalEntryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Check role
  if (!FINANCE_WRITE_ROLES.includes(session.user.role as string)) {
    redirect("/dashboard/journal");
  }

  // The account list and the action come from the same store, which is the
  // rule the `?source=pg` toggle existed to hold: an account id from one store
  // selects nothing in the other, so a form cannot straddle them.
  const accounts = await getPostableAccountsPg();
  const entryTypes = MANUAL_ENTRY_TYPES;

  return (
    <div className="flex flex-col">
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
        <JournalEntryForm
          accounts={accounts}
          entryTypes={entryTypes}
          action={createManualJournalEntry}
        />
      </div>
    </div>
  );
}

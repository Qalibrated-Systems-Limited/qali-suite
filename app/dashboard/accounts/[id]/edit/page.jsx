import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getAccountById } from "@/app/mongodb/queries/accountQueries";
import AccountForm from "../../components/accountForm";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Edit Account | ERP System",
};

export default async function EditAccountPage({ params }) {
  const { id } = await params;

  // Fetch account
  const account = await getAccountById(id);

  if (!account) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/dashboard/accounts/${account._id}`}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Edit Account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Update {account.accountName}
          </p>
        </div>
      </div>

      {/* Form */}
      <AccountForm account={account} />
    </div>
  );
}

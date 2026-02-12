import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import ExpenseForm from "../components/ExpenseForm";
import Account from "@/app/models/account";
import Party from "@/app/models/parties";
import dbConnect from "@/app/config/dbConnect";
import { getExpenseCategories } from "@/app/mongodb/queries/expense-queries";
import { getTenantContext } from "@/lib/utils/tenant-utils";

export const metadata = {
  title: "Create Expense | ERP",
  description: "Record a new business expense",
};

async function getFormData() {
  await dbConnect();
  const { companyId } = await getTenantContext();

  // Fetch all data in parallel
  const [expenseAccounts, paymentAccounts, vendors] = await Promise.all([
    // Expense accounts (for expense posting)
    Account.find({
      companyId,
      accountType: "expense",
      isActive: { $ne: false },
      canPost: true,
    })
      .select("_id accountCode accountName")
      .sort({ accountCode: 1 })
      .lean(),

    // Payment accounts (cash, bank, mpesa)
    Account.find({
      companyId,
      subType: { $in: ["cash", "bank", "mpesa"] },
      isActive: { $ne: false },
      canPost: true,
    })
      .select("_id accountCode accountName subType")
      .sort({ accountCode: 1 })
      .lean(),

    // Vendors (suppliers from parties)
    Party.find({
      companyId,
      type: { $in: ["supplier", "both"] },
      isActive: { $ne: false },
    })
      .select("_id name taxPin phone email")
      .sort({ name: 1 })
      .lean(),
  ]);

  return {
    accounts: expenseAccounts.map((a) => ({
      _id: a._id.toString(),
      accountCode: a.accountCode,
      accountName: a.accountName,
    })),
    paymentAccounts: paymentAccounts.map((a) => ({
      _id: a._id.toString(),
      accountCode: a.accountCode,
      accountName: a.accountName,
      subType: a.subType,
    })),
    vendors: vendors.map((v) => ({
      _id: v._id.toString(),
      name: v.name,
      taxPin: v.taxPin || "",
      phone: v.phone || "",
      email: v.email || "",
    })),
  };
}

export default async function CreateExpensePage() {
  const { accounts, paymentAccounts, vendors } = await getFormData();
  const categories = getExpenseCategories();

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="border-b bg-card/50">
        <div className="container max-w-3xl py-4 sm:py-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="h-8 w-8 shrink-0"
            >
              <Link href="/dashboard/expenses">
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Back to expenses</span>
              </Link>
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Create Expense
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Record a new business expense
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 container max-w-3xl py-6 sm:py-8">
        <ExpenseForm
          accounts={accounts}
          paymentAccounts={paymentAccounts}
          vendors={vendors}
          categories={categories}
        />
      </div>
    </div>
  );
}

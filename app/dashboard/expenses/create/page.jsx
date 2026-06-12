import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import ExpenseForm from "../components/ExpenseForm";
import Account from "@/app/models/account";
import Party from "@/app/models/parties";
import Asset from "@/app/models/asset";
import dbConnect from "@/app/config/dbConnect";
import { getExpenseCategories } from "@/app/mongodb/queries/expense-queries";
import { getTenantContext, tenantFilter } from "@/lib/utils/tenant-utils";
import { getActiveProjects } from "@/app/mongodb/queries/projectQueries";

export const metadata = {
  title: "Create Expense | ERP",
  description: "Record a new business expense",
};

async function getFormData() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  // SuperAdmin: companyId is a UX hint and may be null — { companyId }
  // would match NOTHING. tenantFilter returns {} for SuperAdmin (sees all),
  // matching how every other query in the app behaves.
  const tenant = tenantFilter(companyId, isSuperAdmin);

  // Fetch all data in parallel
  const [expenseAccounts, paymentAccounts, vendors, employees, assets] = await Promise.all(
    [
      // Expense accounts (for expense posting)
      Account.find({
        ...tenant,
        accountType: "expense",
        isActive: { $ne: false },
        canPost: true,
      })
        .select("_id accountCode accountName subType")
        .sort({ accountCode: 1 })
        .lean(),

      // Payment accounts (cash, bank, mpesa)
      Account.find({
        ...tenant,
        subType: { $in: ["cash", "bank", "mpesa"] },
        isActive: { $ne: false },
        canPost: true,
      })
        .select("_id accountCode accountName subType")
        .sort({ accountCode: 1 })
        .lean(),

      // Vendors (suppliers from parties)
      Party.find({
        ...tenant,
        type: { $in: ["supplier", "both"] },
        isActive: { $ne: false },
      })
        .select("_id name taxPin phone email")
        .sort({ name: 1 })
        .lean(),

      // Employees — payees for advances/reimbursements booked by accounts
      Party.find({
        ...tenant,
        type: "employee",
        isActive: { $ne: false },
      })
        .select("_id name phone email")
        .sort({ name: 1 })
        .lean(),

      // Active fixed assets (optional — for tagging fuel/repairs/maintenance)
      Asset.find({
        ...tenant,
        status: { $in: ["active", "idle", "in_maintenance"] },
      })
        .select("_id assetNumber name registrationNumber")
        .sort({ assetNumber: 1 })
        .lean(),
    ]
  );

  return {
    accounts: expenseAccounts.map((a) => ({
      _id: a._id.toString(),
      accountCode: a.accountCode,
      accountName: a.accountName,
      subType: a.subType || "",
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
    employees: employees.map((e) => ({
      _id: e._id.toString(),
      name: e.name,
      phone: e.phone || "",
      email: e.email || "",
    })),
    assets: assets.map((a) => ({
      _id: a._id.toString(),
      assetNumber: a.assetNumber,
      name: a.name,
      registrationNumber: a.registrationNumber || "",
    })),
  };
}

export default async function CreateExpensePage() {
  const [{ accounts, paymentAccounts, vendors, employees, assets }, projects] =
    await Promise.all([getFormData(), getActiveProjects()]);
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
          employees={employees}
          categories={categories}
          projects={projects}
          assets={assets}
        />
      </div>
    </div>
  );
}

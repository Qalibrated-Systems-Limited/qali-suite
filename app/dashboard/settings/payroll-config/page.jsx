import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, Settings } from "lucide-react";
import { getPayrollConfigs } from "@/app/mongodb/queries/hr-queries";
import dbConnect from "@/app/config/dbConnect";
import PayrollConfigClient from "./PayrollConfigClient";

export const metadata = { title: "Payroll Configuration | Settings" };

const ALLOWED = ["SuperAdmin", "Admin", "HR"];

async function getDetailAccounts(companyId) {
  await dbConnect();
  const mongoose = (await import("mongoose")).default;
  const Account = mongoose.model("Account");
  const accounts = await Account.find(
    { companyId, canPost: true, isActive: true },
    "accountCode accountName accountType"
  ).sort({ accountCode: 1 }).lean();
  return accounts.map((a) => ({
    _id: a._id.toString(),
    accountCode: a.accountCode,
    accountName: a.accountName,
    accountType: a.accountType,
  }));
}

async function ConfigLoader({ canEdit, companyId }) {
  const [configs, accounts] = await Promise.all([
    getPayrollConfigs(),
    canEdit ? getDetailAccounts(companyId) : Promise.resolve([]),
  ]);
  return <PayrollConfigClient initialConfigs={configs} canEdit={canEdit} accounts={accounts} />;
}

export default async function PayrollConfigPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!ALLOWED.includes(session.user.role)) redirect("/dashboard/settings");

  const canEdit = session.user.role === "Admin";
  const companyId = session.user.companyId;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/settings" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <span>/</span>
        <span className="text-foreground">Payroll Configuration</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payroll Configuration</h1>
        <p className="mt-1 text-muted-foreground">
          Statutory deduction rates for PAYE, NSSF, SHIF, and AHL. These rates are used when generating payroll entries.
          {!canEdit && " Contact your Admin to make changes."}
        </p>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-blue-200 bg-blue-500/5 px-4 py-3 text-sm text-blue-700 dark:border-blue-900 dark:text-blue-400 space-y-1">
        <p className="font-semibold flex items-center gap-2"><Settings className="h-4 w-4" /> How it works</p>
        <p>Create a config whenever statutory rates change (typically after each Finance Act, July each year). Mark the latest config as <strong>Active</strong> — that config is used for all new payroll runs. Historical runs are always reproducible because they were generated with the rates that were active at the time.</p>
      </div>

      <Suspense
        fallback={
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 rounded-lg border border-border bg-muted/30 animate-pulse" />
            ))}
          </div>
        }
      >
        <ConfigLoader canEdit={canEdit} companyId={companyId} />
      </Suspense>
    </div>
  );
}

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, Settings } from "lucide-react";
import { getPayrollSettings } from "@/app/db/actions/hr-payroll-actions";
import { roleAllowed } from "@/lib/permissions";
import PayrollConfigClient from "./PayrollConfigClient";

export const metadata = { title: "Payroll Configuration | Settings" };

// HR prepares payroll and finance approves it, so both set the rates.
const ALLOWED = ["SuperAdmin", "Admin", "CFO", "Finance Manager", "HR Manager"];

async function ConfigLoader({ canEdit }) {
  const { configs, accounts, active } = await getPayrollSettings();

  // The client speaks `_id`, `isActive` and a `glMapping` object. There is no
  // isActive flag in Postgres — the set of rates whose date range covers today
  // IS the active one, and the ranges cannot overlap (0048), so the answer is
  // singular by construction rather than by a flag somebody has to maintain.
  const shaped = configs.map((c) => ({
    _id: c.id,
    name: c.name,
    effectiveFrom: c.effectiveFrom,
    effectiveTo: c.effectiveTo,
    isActive: c.id === active?.id,
    bracketCount: c.bracketCount,
    glMapping: c.id === active?.id ? (active?.glMapping ?? {}) : {},
    glMapped: c.glMapped,
    glTotal: c.glTotal,
  }));

  return (
    <PayrollConfigClient
      initialConfigs={shaped}
      canEdit={canEdit}
      accounts={accounts.map((a) => ({
        _id: a.id,
        accountCode: a.code,
        accountName: a.name,
        accountType: a.type,
      }))}
    />
  );
}

export default async function PayrollConfigPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, ALLOWED)) redirect("/dashboard/settings");

  // Whoever may open this may change it — the source showed the page to HR and
  // then disabled every control, while the actions accepted them.
  const canEdit = true;

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
        <ConfigLoader canEdit={canEdit} />
      </Suspense>
    </div>
  );
}

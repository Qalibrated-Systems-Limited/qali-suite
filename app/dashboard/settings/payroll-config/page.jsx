import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, Settings } from "lucide-react";
import { getPayrollSettings } from "@/app/db/actions/hr-payroll-actions";
import { can } from "@/lib/capabilities";
import PayrollConfigClient from "./PayrollConfigClient";

export const metadata = { title: "Payroll Configuration | Settings" };

/*
 * NO ROLE ARRAYS HERE ANY MORE.
 *
 * This page held two, and the first of them disagreed with the action behind
 * it: it admitted HR Manager while `getPayrollSettings` — the page's only
 * loader — did not, so HR opened the page straight into the error boundary.
 * Both halves now ask lib/capabilities.js the same question the actions ask.
 *
 *   payroll.rates.write  HR prepares payroll, so HR sets the statutory rates.
 *   payroll.gl.write     Which accounts the journal posts to is finance's.
 */

async function ConfigLoader({ canEdit, canMapGl }) {
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
      canMapGl={canMapGl}
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
  if (!can(session.user.role, "payroll.rates.write")) {
    redirect("/dashboard/settings");
  }

  // Whoever may open this may set the RATES — the source showed the page to HR
  // and then disabled every control, while the actions accepted them.
  const canEdit = true;

  // The GL mapping is the exception, and it is the one control that has to be
  // hidden rather than disabled-on-submit: `savePayrollGlMapping` refuses
  // anyone outside this list, so offering HR the form would be the original
  // bug wearing the other coat.
  const canMapGl = can(session.user.role, "payroll.gl.write");

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
        <ConfigLoader canEdit={canEdit} canMapGl={canMapGl} />
      </Suspense>
    </div>
  );
}

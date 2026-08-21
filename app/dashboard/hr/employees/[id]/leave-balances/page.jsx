import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  getEmployeeLeaveBalances,
  grantYearEntitlements,
} from "@/app/db/actions/hr-leave-actions";
import { HR_ADMIN_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import LeaveBalanceForm from "../../../components/LeaveBalanceForm";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const { employee } = await getEmployeeLeaveBalances(id);
  if (!employee) return { title: "Employee Not Found" };
  return { title: `Leave balances — ${employee.fullName} | HR` };
}

async function LeaveBalancesLoader({ id, year }) {
  const { employee, balances, leaveTypes } = await getEmployeeLeaveBalances(id, year);
  if (!employee) notFound();

  if (!leaveTypes.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          This company has no leave types yet.
        </p>
        <Link
          href="/dashboard/hr/leave-types"
          className="mt-3 inline-block text-sm text-primary hover:underline"
        >
          Set them up
        </Link>
      </div>
    );
  }

  const nothingGranted = balances.every((b) => b.entitledDays === 0 && b.carryOverDays === 0);

  return (
    <div className="space-y-4">
      {nothingGranted && (
        <form
          action={async () => {
            "use server";
            await grantYearEntitlements(id, year);
          }}
          className="rounded-lg border border-amber-200 bg-amber-500/5 p-4 dark:border-amber-900"
        >
          <p className="text-sm text-foreground">
            {employee.fullName} has no leave entitlement for {year} yet.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Grant the standard entitlement for each leave type that applies, then
            adjust any of them below.
          </p>
          <button
            type="submit"
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Grant {year} entitlement
          </button>
        </form>
      )}

      <LeaveBalanceForm employeeId={id} year={year} balances={balances} />
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export default async function LeaveBalancesPage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const year = Number(sp?.year) || new Date().getFullYear();

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_ADMIN_ROLES)) {
    redirect(`/dashboard/hr/employees/${id}`);
  }

  const thisYear = new Date().getFullYear();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/employees" className="hover:text-foreground">
          Employees
        </Link>
        <span>/</span>
        <Link
          href={`/dashboard/hr/employees/${id}`}
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Employee
        </Link>
        <span>/</span>
        <span className="text-foreground">Leave balances</span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Leave balances</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set what was granted. Everything else is counted from the requests.
          </p>
        </div>
        {/* A year picker, because entitlements are per year and the page had no
            way to look at any year but the current one. */}
        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <Link
              key={y}
              href={`?year=${y}`}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                y === year
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <LeaveBalancesLoader id={id} year={year} />
      </Suspense>
    </div>
  );
}

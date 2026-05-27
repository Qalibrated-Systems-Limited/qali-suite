import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getEmployeeById } from "@/app/mongodb/queries/hr-queries";
import LeaveBalanceForm from "../../../components/LeaveBalanceForm";

const LEAVE_ROLES = ["SuperAdmin", "Admin", "HR"];

export async function generateMetadata({ params }) {
  const { id } = await params;
  const { employee } = await getEmployeeById(id);
  if (!employee) return { title: "Employee Not Found" };
  const name = `${employee.personalInfo?.firstName} ${employee.personalInfo?.lastName}`;
  return { title: `Leave Balances — ${name} | HR` };
}

async function LeaveBalancesLoader({ id }) {
  const { employee, error } = await getEmployeeById(id);
  if (error || !employee) notFound();

  const balances = employee.leaveBalances || [];
  if (balances.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">No leave balances configured for this employee.</p>
        <p className="mt-1 text-xs text-muted-foreground">Leave balances are initialised when the employee is created.</p>
      </div>
    );
  }
  return <LeaveBalanceForm profileId={employee._id} balances={balances} />;
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

export default async function LeaveBalancesPage({ params }) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!LEAVE_ROLES.includes(session.user.role)) redirect(`/dashboard/hr/employees/${id}`);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/employees" className="hover:text-foreground">Employees</Link>
        <span>/</span>
        <Link href={`/dashboard/hr/employees/${id}`} className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Employee
        </Link>
        <span>/</span>
        <span className="text-foreground">Leave Balances</span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Manage Leave Balances</h1>
        <p className="mt-1 hidden text-sm text-muted-foreground sm:block">Adjust entitlements and carry-over days</p>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <LeaveBalancesLoader id={id} />
      </Suspense>
    </div>
  );
}

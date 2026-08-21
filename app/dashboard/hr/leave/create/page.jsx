import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getLeaveFormData } from "@/app/db/actions/hr-leave-actions";
import LeaveRequestForm from "@/app/dashboard/hr/components/LeaveRequestForm";

export const metadata = { title: "New leave request | HR" };

async function LeaveFormLoader({ employeeId }) {
  const data = await getLeaveFormData(employeeId);
  return (
    <LeaveRequestForm
      leaveTypes={data.leaveTypes}
      employees={data.employees}
      balances={data.balances}
      me={data.me}
      isApprover={data.isApprover}
    />
  );
}

export default async function CreateLeavePage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;

  return (
    <div className="max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/leave" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Leave
        </Link>
        <span>/</span>
        <span className="text-foreground">New request</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Request leave</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The balance shown is the one the request is checked against.
        </p>
      </div>

      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-muted" />}>
        <LeaveFormLoader employeeId={sp?.employeeId} />
      </Suspense>
    </div>
  );
}

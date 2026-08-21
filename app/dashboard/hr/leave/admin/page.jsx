import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listLeaveTypesForPage } from "@/app/db/actions/hr-leave-actions";
import { HR_ADMIN_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import LeaveAdminClient from "./LeaveAdminClient";

export const metadata = { title: "Leave Administration | HR" };

export default async function LeaveAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_ADMIN_ROLES)) {
    redirect("/dashboard/hr/leave");
  }

  const leaveTypes = await listLeaveTypesForPage();

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/leave" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Leave
        </Link>
        <span>/</span>
        <span className="text-foreground">Year end</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Year end and accrual</h1>
        <p className="mt-1 text-muted-foreground">
          Carry-over and accrual for everybody at once. Both are safe to run
          more than once — they state what the entitlement SHOULD be rather
          than adding to it.
        </p>
      </div>

      <LeaveAdminClient leaveTypes={leaveTypes.filter((t) => t.isActive)} />
    </div>
  );
}

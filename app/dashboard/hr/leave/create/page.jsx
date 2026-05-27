import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import EmployeeProfile from "@/app/models/employeeProfile";
import LeaveRequestForm from "@/app/dashboard/hr/components/LeaveRequestForm";

export const metadata = { title: "New Leave Request | HR" };

const CREATE_ROLES = ["SuperAdmin", "Admin", "Manager", "HR", "Accountant", "Store Manager", "Employee", "Technician", "User", "Viewer"];
const APPROVER_ROLES = ["SuperAdmin", "Admin", "Manager", "HR"];

async function LeaveFormLoader({ isApprover, userId }) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  let employees = [];
  let selfProfile = null;

  if (isApprover) {
    const docs = await EmployeeProfile.find(
      withTenantScope({ "employment.status": { $ne: "terminated" } }, companyId, isSuperAdmin)
    )
      .select("employeeNumber partyId personalInfo.firstName personalInfo.lastName employment.department leaveBalances")
      .sort({ "personalInfo.lastName": 1 })
      .limit(200)
      .lean();

    employees = docs.map((e) => ({
      _id: e._id.toString(),
      partyId: e.partyId.toString(),
      employeeNumber: e.employeeNumber || "",
      name: `${e.personalInfo?.firstName || ""} ${e.personalInfo?.lastName || ""}`.trim(),
      department: e.employment?.department || "",
      leaveBalances: (e.leaveBalances || []).map((b) => ({
        leaveType: b.leaveType,
        label: b.label,
        balanceDays: b.balanceDays,
        pendingDays: b.pendingDays,
        usedDays: b.usedDays,
        entitledDays: b.entitledDays,
      })),
    }));
  } else {
    const profile = await EmployeeProfile.findOne(
      withTenantScope({ userId }, companyId, isSuperAdmin)
    )
      .select("employeeNumber partyId personalInfo.firstName personalInfo.lastName employment.department leaveBalances")
      .lean();

    if (profile) {
      selfProfile = {
        _id: profile._id.toString(),
        partyId: profile.partyId.toString(),
        employeeNumber: profile.employeeNumber || "",
        name: `${profile.personalInfo?.firstName || ""} ${profile.personalInfo?.lastName || ""}`.trim(),
        department: profile.employment?.department || "",
        leaveBalances: (profile.leaveBalances || []).map((b) => ({
          leaveType: b.leaveType,
          label: b.label,
          balanceDays: b.balanceDays,
          pendingDays: b.pendingDays,
          usedDays: b.usedDays,
          entitledDays: b.entitledDays,
        })),
      };
    }
  }

  return <LeaveRequestForm employees={employees} selfProfile={selfProfile} isApprover={isApprover} />;
}

function FormSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export default async function CreateLeaveRequestPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!CREATE_ROLES.includes(session.user.role)) redirect("/dashboard/hr/leave");

  const isApprover = APPROVER_ROLES.includes(session.user.role);
  const userId = session.user.id;

  // Non-approvers (employees) must have a profile to submit leave
  if (!isApprover) {
    const { getMyEmployeeProfile } = await import("@/app/mongodb/queries/hr-queries");
    const profile = await getMyEmployeeProfile();
    if (!profile) {
      return (
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/dashboard/hr/leave" className="flex items-center gap-1 hover:text-foreground">
              <ChevronLeft className="h-4 w-4" /> Leave
            </Link>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-8 text-center dark:border-amber-900">
            <p className="font-semibold text-amber-700 dark:text-amber-400">Employee profile not linked</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Contact HR to set up your employee profile before submitting a leave request.
            </p>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/leave" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Leave
        </Link>
        <span>/</span>
        <span className="text-foreground">New Request</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold">New Leave Request</h1>
        <p className="text-muted-foreground">Submit a leave request for approval</p>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <LeaveFormLoader isApprover={isApprover} userId={userId} />
      </Suspense>
    </div>
  );
}

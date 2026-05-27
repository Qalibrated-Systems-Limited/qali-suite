import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import EmployeeProfile from "@/app/models/employeeProfile";
import LoanRequestForm from "@/app/dashboard/hr/loans/components/LoanRequestForm";

export const metadata = { title: "New Loan Request | HR" };

const CREATE_ROLES = ["SuperAdmin", "Admin", "Manager", "HR", "Employee"];
const ADMIN_ROLES = ["SuperAdmin", "Admin", "Manager", "HR"];

async function LoanFormLoader({ isAdmin, userId }) {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  let employees = [];
  let selfProfile = null;

  if (isAdmin) {
    const docs = await EmployeeProfile.find(
      withTenantScope({ "employment.status": { $ne: "terminated" } }, companyId, isSuperAdmin)
    )
      .select("employeeNumber partyId personalInfo.firstName personalInfo.lastName employment.department")
      .sort({ "personalInfo.lastName": 1 })
      .limit(200)
      .lean();

    employees = docs.map((e) => ({
      _id: e._id.toString(),
      partyId: e.partyId.toString(),
      employeeNumber: e.employeeNumber || "",
      name: `${e.personalInfo?.firstName || ""} ${e.personalInfo?.lastName || ""}`.trim(),
      department: e.employment?.department || "",
    }));
  } else {
    const profile = await EmployeeProfile.findOne(
      withTenantScope({ userId }, companyId, isSuperAdmin)
    )
      .select("employeeNumber partyId personalInfo.firstName personalInfo.lastName employment.department")
      .lean();

    if (profile) {
      selfProfile = {
        _id: profile._id.toString(),
        partyId: profile.partyId.toString(),
        employeeNumber: profile.employeeNumber || "",
        name: `${profile.personalInfo?.firstName || ""} ${profile.personalInfo?.lastName || ""}`.trim(),
        department: profile.employment?.department || "",
      };
    }
  }

  return <LoanRequestForm employees={employees} selfProfile={selfProfile} isAdmin={isAdmin} />;
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

export default async function CreateLoanPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!CREATE_ROLES.includes(session.user.role)) redirect("/dashboard/hr/loans");

  const isAdmin = ADMIN_ROLES.includes(session.user.role);
  const userId = session.user.id;

  // Non-admins (employees) must have a profile
  if (!isAdmin) {
    const { getMyEmployeeProfile } = await import("@/app/mongodb/queries/hr-queries");
    const profile = await getMyEmployeeProfile();
    if (!profile) {
      return (
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/dashboard/hr/loans" className="flex items-center gap-1 hover:text-foreground">
              <ChevronLeft className="h-4 w-4" /> Loans
            </Link>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-500/5 p-8 text-center dark:border-amber-900">
            <p className="font-semibold text-amber-700 dark:text-amber-400">Employee profile not linked</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Contact HR to set up your employee profile before requesting a loan.
            </p>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/loans" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Loans
        </Link>
        <span>/</span>
        <span className="text-foreground">New Request</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">New Loan Request</h1>
        <p className="text-muted-foreground">Request a salary advance, staff loan, or SACCO deduction</p>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <LoanFormLoader isAdmin={isAdmin} userId={userId} />
      </Suspense>
    </div>
  );
}

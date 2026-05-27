import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import Department from "@/app/models/department";
import EmployeeProfile from "@/app/models/employeeProfile";
import EmployeeForm from "../../components/EmployeeForm";

export const metadata = { title: "Add Employee | HR" };

const HR_ROLES = ["SuperAdmin", "Admin", "Manager", "HR"];

// ============================================
// FETCH FORM DEPENDENCIES (server-only)
// ============================================
async function getFormData() {
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const [departments, managers] = await Promise.all([
    Department.find(withTenantScope({ isActive: true }, companyId, isSuperAdmin))
      .select("_id name code")
      .sort({ name: 1 })
      .lean(),
    EmployeeProfile.find(
      withTenantScope(
        { "employment.status": { $in: ["active", "probation"] } },
        companyId,
        isSuperAdmin
      )
    )
      .select("partyId employeeNumber personalInfo.firstName personalInfo.lastName employment.designation")
      .sort({ "personalInfo.lastName": 1 })
      .lean(),
  ]);

  return {
    departments: departments.map((d) => ({ _id: d._id.toString(), name: d.name, code: d.code })),
    managers: managers.map((m) => ({
      _id: m._id.toString(),
      partyId: m.partyId.toString(),
      personalInfo: {
        firstName: m.personalInfo?.firstName || "",
        lastName: m.personalInfo?.lastName || "",
      },
      employment: { designation: m.employment?.designation || null },
    })),
  };
}

async function FormWrapper({ defaults }) {
  const { departments, managers } = await getFormData();
  return <EmployeeForm departments={departments} managers={managers} defaults={defaults} />;
}

// ============================================
// PAGE
// ============================================
export default async function CreateEmployeePage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!HR_ROLES.includes(session.user.role)) redirect("/dashboard/hr");

  const params = await searchParams;
  const linkedUserId = params.userId || null;
  const defaults = linkedUserId
    ? {
        linkedUserId,
        email: params.email || "",
        firstName: params.name ? params.name.split(" ")[0] : "",
        lastName: params.name ? params.name.split(" ").slice(1).join(" ") : "",
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/employees" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Employees
        </Link>
        <span>/</span>
        <span className="text-foreground">Add Employee</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Add Employee</h1>
        <p className="text-muted-foreground">
          {defaults ? `Creating profile for ${params.email}` : "Create a new employee record"}
        </p>
      </div>

      <Suspense
        fallback={
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        }
      >
        <FormWrapper defaults={defaults} />
      </Suspense>
    </div>
  );
}

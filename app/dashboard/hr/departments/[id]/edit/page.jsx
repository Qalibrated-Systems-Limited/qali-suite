import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getDepartmentById } from "@/app/mongodb/queries/hr-queries";
import dbConnect from "@/app/config/dbConnect";
import EmployeeProfile from "@/app/models/employeeProfile";
import { getTenantContext, withTenantScope } from "@/lib/utils/tenant-utils";
import DepartmentEditForm from "../../../components/DepartmentEditForm";

const EDIT_ROLES = ["SuperAdmin", "Admin", "Manager", "HR"];

export async function generateMetadata({ params }) {
  const { id } = await params;
  const { department } = await getDepartmentById(id);
  if (!department) return { title: "Department Not Found" };
  return { title: `Edit ${department.name} | HR` };
}

async function DeptEditLoader({ id }) {
  const { department, error } = await getDepartmentById(id);
  if (error || !department) notFound();

  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();

  const profiles = await EmployeeProfile.find(
    withTenantScope({ "employment.status": { $in: ["active", "probation"] } }, companyId, isSuperAdmin)
  )
    .select("partyId employeeNumber personalInfo.firstName personalInfo.lastName")
    .sort({ "personalInfo.lastName": 1 })
    .limit(200)
    .lean();

  const employees = profiles.map((p) => ({
    partyId: p.partyId?.toString() || "",
    employeeNumber: p.employeeNumber || "",
    name: `${p.personalInfo?.firstName || ""} ${p.personalInfo?.lastName || ""}`.trim(),
  }));

  return <DepartmentEditForm department={department} employees={employees} />;
}

function FormSkeleton() {
  return <div className="h-48 animate-pulse rounded-lg bg-muted" />;
}

export default async function DepartmentEditPage({ params }) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!EDIT_ROLES.includes(session.user.role)) redirect(`/dashboard/hr/departments/${id}`);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/departments" className="hover:text-foreground">Departments</Link>
        <span>/</span>
        <Link href={`/dashboard/hr/departments/${id}`} className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Department
        </Link>
        <span>/</span>
        <span className="text-foreground">Edit</span>
      </div>

      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Edit Department</h1>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <DeptEditLoader id={id} />
      </Suspense>
    </div>
  );
}

import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getDepartmentForPage } from "@/app/db/actions/hr-department-actions";
import { searchEmployees } from "@/app/db/actions/hr-employee-actions";
import { HR_WRITE_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import DepartmentEditForm from "../../../components/DepartmentEditForm";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const department = await getDepartmentForPage(id);
  if (!department) return { title: "Department Not Found" };
  return { title: `Edit ${department.name} | HR` };
}

async function DeptEditLoader({ id }) {
  const department = await getDepartmentForPage(id);
  if (!department) notFound();

  // The head picker offers everyone still employed. The Mongo page fetched
  // only active and probation, so somebody suspended or on leave could not be
  // named as head — and neither could they be removed as one.
  const employees = await searchEmployees("");

  return <DepartmentEditForm department={department} employees={employees} />;
}

function FormSkeleton() {
  return <div className="h-48 animate-pulse rounded-lg bg-muted" />;
}

export default async function DepartmentEditPage({ params }) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_WRITE_ROLES)) {
    redirect(`/dashboard/hr/departments/${id}`);
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/departments" className="hover:text-foreground">
          Departments
        </Link>
        <span>/</span>
        <Link
          href={`/dashboard/hr/departments/${id}`}
          className="flex items-center gap-1 hover:text-foreground"
        >
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

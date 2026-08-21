import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { HR_ADMIN_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import BulkImportClient from "./BulkImportClient";

export const metadata = { title: "Import Employees | HR" };

export default async function EmployeeImportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, HR_ADMIN_ROLES)) {
    redirect("/dashboard/hr/employees");
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/employees" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Employees
        </Link>
        <span>/</span>
        <span className="text-foreground">Bulk Import</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import Employees</h1>
        <p className="mt-1 text-muted-foreground">
          Upload a CSV to create several employees at once — at most 200 rows.
          Departments named in the file are matched to existing ones and created
          if they are new, and each employee is granted this year&apos;s leave
          entitlement.
        </p>
      </div>

      <BulkImportClient />
    </div>
  );
}

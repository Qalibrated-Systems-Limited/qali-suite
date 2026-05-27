import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import BulkImportClient from "./BulkImportClient";

export const metadata = { title: "Import Employees | HR" };

const ALLOWED = ["SuperAdmin", "Admin", "HR"];

export default async function EmployeeImportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!ALLOWED.includes(session.user.role)) redirect("/dashboard/hr/employees");

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
        <p className="mt-1 text-muted-foreground">Upload a CSV file to create multiple employees at once. Max 200 rows per import.</p>
      </div>

      <BulkImportClient />
    </div>
  );
}

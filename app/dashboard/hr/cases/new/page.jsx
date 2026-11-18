import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { getRecordsFormData } from "@/app/db/actions/hr-records-actions";
import CaseForm from "./CaseForm";

export const metadata = { title: "Open a case | HR" };

export default async function NewCasePage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "hr.discipline")) redirect("/dashboard/hr");
  const sp = await searchParams;
  const { employees } = await getRecordsFormData();
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Link href="/dashboard/hr/cases" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Disciplinary & grievances
      </Link>
      <h1 className="text-2xl font-bold">Open a case</h1>
      <CaseForm employees={employees} defaultEmployeeId={sp?.employee || ""} />
    </div>
  );
}

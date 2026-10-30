import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getExitFormData } from "@/app/db/actions/hr-exit-actions";
import { can } from "@/lib/capabilities";
import ExitForm from "../components/ExitForm";

export const metadata = { title: "Start an exit | HR" };

async function FormLoader({ employeeId }) {
  const { employees } = await getExitFormData();
  return <ExitForm employees={employees} defaultEmployeeId={employeeId} />;
}

export default async function CreateExitPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "exit.manage")) redirect("/dashboard/hr/exits");
  const { employeeId = "" } = await searchParams;

  return (
    <div className="max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/exits" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Exits
        </Link>
        <span>/</span>
        <span className="text-foreground">Start an exit</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Start an exit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This opens the clearance checklist and works out the final dues. Nothing
          is posted and the employment does not end until finance approves the dues.
        </p>
      </div>

      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-muted" />}>
        <FormLoader employeeId={employeeId} />
      </Suspense>
    </div>
  );
}

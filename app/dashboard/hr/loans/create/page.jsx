import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getLoanFormData } from "@/app/db/actions/hr-loan-actions";
import { roleAllowed } from "@/lib/permissions";
import LoanRequestForm from "@/app/dashboard/hr/loans/components/LoanRequestForm";

export const metadata = { title: "New loan request | HR" };

// Raising a loan request is an HR act — the employee asks, HR records it, and
// finance approves. Matches the action's gate.
const CREATE_ROLES = ["SuperAdmin", "Admin", "Manager", "HR Manager"];

async function LoanFormLoader() {
  const { employees } = await getLoanFormData();
  return <LoanRequestForm employees={employees} isAdmin />;
}

export default async function CreateLoanPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!roleAllowed(session.user.role, CREATE_ROLES)) redirect("/dashboard/hr/loans");

  return (
    <div className="max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/hr/loans" className="flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Loans
        </Link>
        <span>/</span>
        <span className="text-foreground">New request</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">New loan request</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The repayment schedule is worked out from the terms, and a repayment
          larger than two thirds of monthly pay is refused — that is the
          statutory cap on deductions.
        </p>
      </div>

      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-muted" />}>
        <LoanFormLoader />
      </Suspense>
    </div>
  );
}

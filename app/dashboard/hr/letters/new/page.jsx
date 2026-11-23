import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { getRecordsFormData } from "@/app/db/actions/hr-records-actions";
import LetterForm from "../LetterForm";

export const metadata = { title: "New letter | HR" };

export default async function NewLetterPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "hr.letters")) redirect("/dashboard/hr");
  const sp = await searchParams;
  const { employees } = await getRecordsFormData();
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <Link href="/dashboard/hr/letters" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Letters
      </Link>
      <h1 className="text-2xl font-bold">Issue a letter</h1>
      <LetterForm
        employees={employees}
        defaultEmployeeId={sp?.employee || ""}
        defaultKind={sp?.kind || "appointment"}
        signatory={{ name: session.user.name }}
      />
    </div>
  );
}

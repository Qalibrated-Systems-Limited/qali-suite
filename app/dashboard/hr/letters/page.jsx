import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { listHrLetters } from "@/app/db/actions/hr-records-actions";
import { LETTER_KIND_LABELS, fmtDay } from "@/lib/hr/record-labels";
import { PageHeader, Badge, Empty } from "../components/records-ui";
import { inputClass } from "../components/records-styles";

export const metadata = { title: "Letters | HR" };

export default async function LettersPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "hr.letters")) redirect("/dashboard/hr");
  const sp = await searchParams;
  const letters = await listHrLetters({ kind: sp?.kind || "", search: sp?.q || "" });

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title="Letters"
        sub="Offer, appointment, confirmation, promotion, warning and other letters — issued, numbered and kept on the employee's file."
        actions={
          <Link href="/dashboard/hr/letters/new" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Issue a letter
          </Link>
        }
      />
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={sp?.q || ""} placeholder="Search number, subject or employee…" className={`${inputClass()} max-w-sm`} />
        <select name="kind" defaultValue={sp?.kind || ""} className={`${inputClass()} max-w-xs`}>
          <option value="">All kinds</option>
          {Object.entries(LETTER_KIND_LABELS).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        <button className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">Filter</button>
      </form>
      {letters.length === 0 ? (
        <Empty>No letters yet.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Ref</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Letter</th>
                <th className="px-4 py-3">Dated</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {letters.map((l) => (
                <tr key={l.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/dashboard/hr/letters/${l.id}`} className="text-primary hover:underline">{l.letter_number}</Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{l.employee_name}</p>
                    <p className="text-xs text-muted-foreground">{l.employee_number}{l.department ? ` · ${l.department}` : ""}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{l.subject}</p>
                    <p className="text-xs text-muted-foreground">{LETTER_KIND_LABELS[l.kind]}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDay(l.issued_on)}</td>
                  <td className="px-4 py-3">{l.status === "void" ? <Badge tone="red">Void</Badge> : <Badge tone="green">Issued</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

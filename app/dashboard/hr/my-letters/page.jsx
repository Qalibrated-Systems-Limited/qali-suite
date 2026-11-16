import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listMyLetters } from "@/app/db/actions/hr-records-actions";
import { LETTER_KIND_LABELS, fmtDay } from "@/lib/hr/record-labels";
import { PageHeader, Empty } from "../components/records-ui";

export const metadata = { title: "My letters | HR" };

/** The letters HR has issued to the signed-in employee — their own copies. */
export default async function MyLettersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const letters = await listMyLetters().catch(() => []);
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="My letters" sub="Letters HR has issued to you. Open one to read it or download the PDF." />
      {letters.length === 0 ? (
        <Empty>No letters yet.</Empty>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
          {letters.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <Link href={`/dashboard/hr/letters/${l.id}`} className="font-medium text-primary hover:underline">{l.subject}</Link>
              <span className="text-xs text-muted-foreground">{LETTER_KIND_LABELS[l.kind]} · {fmtDay(l.issued_on)} · {l.letter_number}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

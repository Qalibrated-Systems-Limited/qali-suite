import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { getHrLetter } from "@/app/db/actions/hr-records-actions";
import { LETTER_KIND_LABELS, fmtDay } from "@/lib/hr/record-labels";
import PdfPreviewButton from "@/components/pdf/PdfPreviewButton";
import { Badge } from "../../components/records-ui";
import LetterActions from "./LetterActions";

export const metadata = { title: "Letter | HR" };

export default async function LetterPage({ params }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const l = await getHrLetter(id);
  if (!l) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <Link href={l.canManage ? "/dashboard/hr/letters" : "/dashboard/hr/my-letters"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Letters
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{l.letter_number}</p>
          <h1 className="text-2xl font-bold">{l.subject}</h1>
          <p className="text-sm text-muted-foreground">
            {LETTER_KIND_LABELS[l.kind]} · {l.employee_name} ({l.employee_number}) · dated {fmtDay(l.issued_on)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {l.status === "void" ? <Badge tone="red">Void</Badge> : <Badge tone="green">Issued</Badge>}
          <PdfPreviewButton
            href={`/api/hr/letters/${l.id}/pdf`}
            title={`${l.letter_number} — ${l.subject}`}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            label="Preview PDF"
          />
          <a href={`/api/hr/letters/${l.id}/pdf?download=1`} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Download PDF
          </a>
        </div>
      </div>
      {l.status === "void" && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          Voided: {l.void_reason}
        </div>
      )}
      <div className="whitespace-pre-wrap rounded-lg border border-border bg-card p-6 text-sm leading-relaxed shadow-sm">{l.body}</div>
      <p className="text-xs text-muted-foreground">
        Issued by {l.created_by_name || "—"}
        {l.signatory_name ? ` · signed by ${l.signatory_name}${l.signatory_title ? `, ${l.signatory_title}` : ""}` : ""}
      </p>
      {l.canManage && l.status === "issued" && <LetterActions id={l.id} />}
    </div>
  );
}

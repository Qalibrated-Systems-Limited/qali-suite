import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { getPerformanceReview } from "@/app/db/actions/hr-records-actions";
import { REVIEW_STATUS_LABELS, fmtDay } from "@/lib/hr/record-labels";
import { Badge } from "../../components/records-ui";
import ReviewEditor from "./ReviewEditor";

export const metadata = { title: "Performance review | HR" };

export default async function ReviewPage({ params }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const r = await getPerformanceReview(id);
  if (!r) notFound();
  const back = r.parts.includes("hr") || r.parts.includes("reviewer") ? "/dashboard/hr/reviews" : "/dashboard/hr/my-reviews";
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <Link href={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Reviews
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{r.employee_name} — {r.cycle}</h1>
          <p className="text-sm text-muted-foreground">
            {r.employee_number}{r.designation ? ` · ${r.designation}` : ""} · {fmtDay(r.period_start)} – {fmtDay(r.period_end)} · reviewer {r.reviewer_name || "HR / any manager"}
          </p>
        </div>
        <div className="text-right">
          <Badge tone={r.status === "completed" ? "green" : "amber"}>{REVIEW_STATUS_LABELS[r.status]}</Badge>
          {r.overall_rating && <p className="mt-1 text-2xl font-bold">{Number(r.overall_rating).toFixed(2)} <span className="text-sm font-normal text-muted-foreground">/ 5</span></p>}
          {r.employee_acknowledged_at && <p className="text-xs text-muted-foreground">Acknowledged by the employee</p>}
        </div>
      </div>
      <ReviewEditor r={r} />
    </div>
  );
}

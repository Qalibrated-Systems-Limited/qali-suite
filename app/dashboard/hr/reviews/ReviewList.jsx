import Link from "next/link";
import { REVIEW_STATUS_LABELS, fmtDay } from "@/lib/hr/record-labels";
import { Badge, Empty } from "../components/records-ui";

const tone = (s) => (s === "completed" ? "green" : s === "draft" ? "gray" : "amber");

export default function ReviewList({ reviews, empty = "No reviews yet." }) {
  if (!reviews.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Cycle</th>
            <th className="px-4 py-3">Period</th>
            <th className="px-4 py-3">Reviewer</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Rating</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {reviews.map((r) => (
            <tr key={r.id} className="hover:bg-muted/50">
              <td className="px-4 py-3">
                <Link href={`/dashboard/hr/reviews/${r.id}`} className="font-medium text-primary hover:underline">{r.employee_name}</Link>
                <p className="text-xs text-muted-foreground">{r.employee_number}{r.department ? ` · ${r.department}` : ""}</p>
              </td>
              <td className="px-4 py-3">{r.cycle}</td>
              <td className="px-4 py-3 text-muted-foreground">{fmtDay(r.period_start)} – {fmtDay(r.period_end)}</td>
              <td className="px-4 py-3">{r.reviewer_name || "HR / any manager"}</td>
              <td className="px-4 py-3"><Badge tone={tone(r.status)}>{REVIEW_STATUS_LABELS[r.status]}</Badge></td>
              <td className="px-4 py-3 text-right font-medium">{r.overall_rating ? Number(r.overall_rating).toFixed(2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

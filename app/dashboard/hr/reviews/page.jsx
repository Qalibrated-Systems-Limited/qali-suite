import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { can } from "@/lib/capabilities";
import { listPerformanceReviews, getRecordsFormData } from "@/app/db/actions/hr-records-actions";
import { REVIEW_STATUS_LABELS } from "@/lib/hr/record-labels";
import { PageHeader } from "../components/records-ui";
import StartReview from "./StartReview";
import ReviewList from "./ReviewList";

export const metadata = { title: "Performance reviews | HR" };

export default async function ReviewsPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "hr.reviews")) redirect("/dashboard/hr");
  const sp = await searchParams;
  const isHr = can(session.user, "hr.admin");
  const [reviews, form] = await Promise.all([
    listPerformanceReviews({ status: sp?.status || "" }),
    isHr ? getRecordsFormData() : null,
  ]);
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title="Performance reviews"
        sub={isHr
          ? "HR sets the objectives; the employee assesses themselves; the reviewer rates each objective; the overall rating is the weighted result."
          : "The reviews you are named on as reviewer."}
      />
      {isHr && <StartReview employees={form.employees} reviewers={form.reviewers} />}
      <div className="flex flex-wrap gap-2">
        {[["", "All"], ...Object.entries(REVIEW_STATUS_LABELS)].map(([k, l]) => (
          <Link key={k || "all"} href={`?status=${k}`} className={`rounded-full border px-3 py-1 text-xs ${(sp?.status || "") === k ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}>
            {l}
          </Link>
        ))}
      </div>
      <ReviewList reviews={reviews} />
    </div>
  );
}

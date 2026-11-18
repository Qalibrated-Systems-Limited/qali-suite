import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listMyReviews } from "@/app/db/actions/hr-records-actions";
import { PageHeader } from "../components/records-ui";
import ReviewList from "../reviews/ReviewList";

export const metadata = { title: "My reviews | HR" };

export default async function MyReviewsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const reviews = await listMyReviews().catch(() => []);
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader title="My performance reviews" sub="Open a review to complete your self-assessment, or to read and acknowledge a completed one." />
      <ReviewList reviews={reviews} empty="You have no performance reviews yet." />
    </div>
  );
}

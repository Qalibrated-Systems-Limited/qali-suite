import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { getClaimById } from "@/app/mongodb/queries/claimQueries";
import { AdvanceSettlementForm } from "../../components/AdvanceSettleForm";

export const metadata = {
  title: "Settle Advance | ERP System",
  description: "Submit settlement for your advance",
};

export default async function SettleAdvancePage({ params }) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Fetch the advance claim
  const claim = await getClaimById(id);

  if (!claim) {
    notFound();
  }

  // Verify it's an advance request
  if (claim.claimType !== "advance_request") {
    redirect(`/dashboard/claims/${id}`);
  }

  // Verify user is the owner
  const isOwner = claim.employee.userId === user.id;
  if (!isOwner) {
    redirect("/dashboard/claims/my-claims");
  }

  // Verify advance is paid (can only settle paid advances)
  if (claim.status !== "paid") {
    redirect(`/dashboard/claims/${id}`);
  }

  // Check if already settled
  if (claim.settlementClaimId) {
    redirect(`/dashboard/claims/${claim.settlementClaimId}`);
  }

  return <AdvanceSettlementForm advanceClaim={claim} />;
}

import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import {
  getClaimById,
  getExpenseAccountsForCategories,
} from "@/app/mongodb/queries/claimQueries";
import { getActiveProjects } from "@/app/mongodb/queries/projectQueries";
import { AdvanceRequestForm } from "../../components/AdvanceRequestForm";
import { ReimbursementForm } from "../../components/ReimbursementForm";

export const metadata = {
  title: "Edit Claim | ERP System",
  description: "Edit your expense claim",
};

export default async function EditClaimPage({ params }) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;
  const userRole = user.role?.toLowerCase();

  // Fetch claim
  const claim = await getClaimById(id);

  if (!claim) {
    notFound();
  }

  // Check permissions
  const isOwner = claim.employee.userId === user.id;
  const isManager = userRole === "manager" || userRole === "admin";

  // Only owner and managers can edit
  if (!isOwner && !isManager) {
    redirect("/dashboard/my-claims");
  }

  // Can only edit draft or rejected claims
  if (claim.status !== "draft" && claim.status !== "rejected") {
    redirect(`/dashboard/claims/${id}`);
  }

  const [expenseAccounts, projects] = await Promise.all([
    getExpenseAccountsForCategories(),
    getActiveProjects(),
  ]);

  // Render appropriate form based on claim type
  if (claim.claimType === "advance_request") {
    return <AdvanceRequestForm claim={claim} projects={projects} />;
  } else if (claim.claimType === "reimbursement") {
    return <ReimbursementForm claim={claim} expenseAccounts={expenseAccounts} projects={projects} />;
  } else {
    // Settlement claims cannot be edited
    redirect(`/dashboard/claims/${id}`);
  }
}

import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import {
  getClaimById,
  getExpenseAccountsForCategories,
} from "@/app/db/actions/claim-actions";
import { getActiveProjects } from "@/app/db/actions/project-actions";
import { AdvanceRequestForm } from "../../components/AdvanceRequestForm";
import { ReimbursementForm } from "../../components/ReimbursementForm";
import { getAllCostCodes } from "@/app/db/actions/project-actions";
import { hasRole, CLAIM_APPROVE_ROLES } from "@/lib/utils/role-gates";

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

  // Fetch claim
  const claim = await getClaimById(id);

  if (!claim) {
    notFound();
  }

  /*
   * The same inline role strings the detail page carried, with the same hole:
   * "superadmin", "cfo" and "finance manager" are none of them, so the people
   * CLAIM_APPROVE_ROLES names were bounced to /dashboard/my-claims.
   */
  const isOwner = claim.employee.userId === user.id;
  const canActForOthers = hasRole(user, CLAIM_APPROVE_ROLES);

  if (!isOwner && !canActForOthers) {
    redirect("/dashboard/my-claims");
  }

  // Can only edit draft or rejected claims
  if (claim.status !== "draft" && claim.status !== "rejected") {
    redirect(`/dashboard/claims/${id}`);
  }

  const [expenseAccounts, projects, costCodes] = await Promise.all([
    getExpenseAccountsForCategories(),
    getActiveProjects(),
    getAllCostCodes(),
  ]);

  // Render appropriate form based on claim type
  if (claim.claimType === "advance_request") {
    return <AdvanceRequestForm claim={claim} projects={projects} costCodes={costCodes} />;
  } else if (claim.claimType === "reimbursement") {
    return <ReimbursementForm claim={claim} expenseAccounts={expenseAccounts} projects={projects} costCodes={costCodes} />;
  } else {
    // Settlement claims cannot be edited
    redirect(`/dashboard/claims/${id}`);
  }
}

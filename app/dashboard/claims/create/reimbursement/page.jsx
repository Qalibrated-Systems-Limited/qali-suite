import { ReimbursementForm } from "../../components/ReimbursementForm";
import { getExpenseAccountsForCategories } from "@/app/db/actions/claim-actions";
import { getActiveProjects } from "@/app/db/actions/project-actions";
import { getAllCostCodes } from "@/app/db/actions/project-actions";
import { safeReturnTo } from "@/lib/utils/return-to";

export const metadata = {
  title: "Create Reimbursement | ERP System",
  description: "Submit an expense reimbursement claim",
};

/** `?projectId=` / `?returnTo=` — see the advance page beside this one. */
export default async function CreateReimbursementPage({ searchParams }) {
  const sp = await searchParams;
  const [expenseAccounts, projects, costCodes] = await Promise.all([
    getExpenseAccountsForCategories(),
    getActiveProjects(),
    getAllCostCodes(),
  ]);

  return (
    <ReimbursementForm
      expenseAccounts={expenseAccounts}
      projects={projects}
      costCodes={costCodes}
      defaultProjectId={sp?.projectId || ""}
      returnTo={safeReturnTo(sp?.returnTo)}
    />
  );
}

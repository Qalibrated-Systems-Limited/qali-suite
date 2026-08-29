import { ReimbursementForm } from "../../components/ReimbursementForm";
import { getExpenseAccountsForCategories } from "@/app/db/actions/claim-actions";
import { getActiveProjects } from "@/app/db/actions/project-actions";
import { getAllCostCodes } from "@/app/db/actions/project-actions";

export const metadata = {
  title: "Create Reimbursement | ERP System",
  description: "Submit an expense reimbursement claim",
};

export default async function CreateReimbursementPage() {
  const [expenseAccounts, projects, costCodes] = await Promise.all([
    getExpenseAccountsForCategories(),
    getActiveProjects(),
    getAllCostCodes(),
  ]);

  return <ReimbursementForm expenseAccounts={expenseAccounts} projects={projects} costCodes={costCodes} />;
}

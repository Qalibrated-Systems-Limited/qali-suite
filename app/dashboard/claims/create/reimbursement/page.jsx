import { ReimbursementForm } from "../../components/ReimbursementForm";
import { getExpenseAccountsForCategories } from "@/app/db/actions/claim-actions";
import { getActiveProjects } from "@/app/db/actions/project-actions";

export const metadata = {
  title: "Create Reimbursement | ERP System",
  description: "Submit an expense reimbursement claim",
};

export default async function CreateReimbursementPage() {
  const [expenseAccounts, projects] = await Promise.all([
    getExpenseAccountsForCategories(),
    getActiveProjects(),
  ]);

  return <ReimbursementForm expenseAccounts={expenseAccounts} projects={projects} />;
}

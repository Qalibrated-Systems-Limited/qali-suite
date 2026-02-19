import { ReimbursementForm } from "../../components/ReimbursementForm";
import { getExpenseAccountsForCategories } from "@/app/mongodb/queries/claimQueries";
import { getActiveProjects } from "@/app/mongodb/queries/projectQueries";

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

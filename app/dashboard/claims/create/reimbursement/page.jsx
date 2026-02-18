import { ReimbursementForm } from "../../components/ReimbursementForm";
import { getExpenseAccountsForCategories } from "@/app/mongodb/queries/claimQueries";

export const metadata = {
  title: "Create Reimbursement | ERP System",
  description: "Submit an expense reimbursement claim",
};

export default async function CreateReimbursementPage() {
  const expenseAccounts = await getExpenseAccountsForCategories();

  return <ReimbursementForm expenseAccounts={expenseAccounts} />;
}

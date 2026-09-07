import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { getAllCostCodes, getActiveProjects } from "@/app/db/actions/project-actions";
import { getExpenseAccountsForCategories } from "@/app/db/actions/claim-actions";
import { FINANCE_WRITE_ROLES, PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";
import CostCodeManager from "../components/CostCodeManager";

export const metadata = {
  title: "Cost Codes | ERP System",
  description: "The vocabulary project budgets are built from",
};

/**
 * The cost codes page — 0073, and it has never existed in either store.
 *
 * `getAllCostCodes` has carried the comment "for management page" since the
 * Mongo module shipped, and there was no management page: no cost code could
 * be created through the app at all, in Mongo or in Postgres.
 *
 * READ by anyone who manages projects, WRITTEN by finance. A cost code now
 * carries the GL account it charges, so defining one is a chart-of-accounts
 * decision — and keeping the chart away from the person filling in a budget
 * is the whole reason cost codes sit in front of it.
 */
export default async function CostCodesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  if (!PROJECT_MANAGE_ROLES.includes(role)) redirect("/dashboard/projects");
  const canManage = FINANCE_WRITE_ROLES.includes(role);

  const [costCodes, accounts, projects] = await Promise.all([
    getAllCostCodes(),
    getExpenseAccountsForCategories(),
    getActiveProjects(),
  ]);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 sm:gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/projects">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">
            Cost Codes
          </h1>
          <p className="text-sm text-muted-foreground">
            What project budgets are built from, and the account each one charges
          </p>
        </div>
      </div>

      <CostCodeManager
        costCodes={costCodes}
        accounts={accounts}
        projects={projects}
        canManage={canManage}
      />
    </div>
  );
}

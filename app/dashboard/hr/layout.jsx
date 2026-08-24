import { auth } from "@/auth";
import { redirect } from "next/navigation";
import HRNav from "./components/HRNav";
import { PlanGate } from "@/components/plan-gate-boundary";

export default async function HRLayout({ children }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role || "Employee";

  /**
   * THE PLAN GATE LIVES HERE NOW, covering all 31 pages under /dashboard/hr.
   *
   * It used to say plan gating was "handled at the individual page and
   * server-action level". It was not: no HR page checked, and only two HR API
   * routes did. The sidebar hid the group on plans without `hr` and nothing
   * else stopped anyone — the command palette and a typed URL both worked, so
   * a free-plan company had a working HR module.
   *
   * The old comment carved out the self-service pages (my-leave,
   * my-attendance, my-payslips) so they would never be blocked. That carve-out
   * no longer matches the product: `hr-my-leave`, `hr-my-attendance` and
   * `hr-my-payslips` are all Professional modules in lib/plans.js, and the
   * sidebar hides the whole HR group — self-service included — when the plan
   * lacks `hr`. Exempting them here would be the only place in the system that
   * disagreed. To restore it, move <PlanGate> to wrap everything except the
   * self-service routes rather than adding a path check here; a layout cannot
   * see the pathname.
   */
  return (
    <PlanGate module="hr" feature="Human Resources">
      <div className="flex flex-col">
        <HRNav role={role} />
        <main className="flex-1">{children}</main>
      </div>
    </PlanGate>
  );
}

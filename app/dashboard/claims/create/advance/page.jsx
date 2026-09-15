import { auth } from "@/auth";
import { AdvanceRequestForm } from "../../components/AdvanceRequestForm";
import { getActiveProjects } from "@/app/db/actions/project-actions";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { getUsers } from "@/app/db/actions/user-actions";
import { getAllCostCodes } from "@/app/db/actions/project-actions";
import { safeReturnTo } from "@/lib/utils/return-to";

export const dynamic = "force-dynamic";

// Finance roles can record an advance ON BEHALF of an employee — the
// fix for "manual" advances that used to bypass the system entirely.
// Postgres since 0070. This read the Mongo `users` collection, which auth
// stopped writing to when it ported — so the on-behalf picker has been empty
// for every finance user, and the "manual advances that bypass the system"
// this feature exists to stop went on bypassing it.
async function getOnBehalfOptions(role) {
  if (!FINANCE_WRITE_ROLES.includes(role)) return [];
  const users = await getUsers();
  return users.map((u) => ({
    _id: u._id,
    name: u.name,
    email: u.email || "",
    role: u.role,
  }));
}

/**
 * `?projectId=` and `?returnTo=` — raising an advance FROM a project.
 *
 * Somebody working a job who needs cash for it had to leave the module, find
 * My Claims, start a claim, and then pick the project they had been looking at
 * thirty seconds earlier out of a combobox — and if they forgot that last step
 * the money never reached the job's cost at all. The Projects module links
 * straight here now with both the project and the way back.
 *
 * `returnTo` is validated, not trusted: see lib/utils/return-to.js.
 */
export default async function AdvanceCreatePage({ searchParams }) {
  const sp = await searchParams;
  const session = await auth();
  const role = session?.user?.role;
  const [projects, costCodes, onBehalfOptions] = await Promise.all([
    getActiveProjects(),
    getAllCostCodes(),
    getOnBehalfOptions(role),
  ]);
  return (
    <AdvanceRequestForm
      projects={projects}
      onBehalfOptions={onBehalfOptions}
      currentUserId={session?.user?.id || ""} costCodes={costCodes}
      defaultProjectId={sp?.projectId || ""}
      returnTo={safeReturnTo(sp?.returnTo)}
    />
  );
}

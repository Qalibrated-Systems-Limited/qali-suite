import { auth } from "@/auth";
import { AdvanceRequestForm } from "../../components/AdvanceRequestForm";
import { getActiveProjects } from "@/app/db/actions/project-actions";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import { getUsers } from "@/app/db/actions/user-actions";
import { getAllCostCodes } from "@/app/db/actions/project-actions";

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

export default async function AdvanceCreatePage() {
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
    />
  );
}

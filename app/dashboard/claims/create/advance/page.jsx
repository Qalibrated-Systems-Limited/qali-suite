import { auth } from "@/auth";
import { AdvanceRequestForm } from "../../components/AdvanceRequestForm";
import { getActiveProjects } from "@/app/mongodb/queries/projectQueries";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import dbConnect from "@/app/config/dbConnect";
import User from "@/app/models/user";
import { getTenantContext, tenantFilter } from "@/lib/utils/tenant-utils";

export const dynamic = "force-dynamic";

// Finance roles can record an advance ON BEHALF of an employee — the
// fix for "manual" advances that used to bypass the system entirely.
async function getOnBehalfOptions(role) {
  if (!FINANCE_WRITE_ROLES.includes(role)) return [];
  await dbConnect();
  const { companyId, isSuperAdmin } = await getTenantContext();
  const users = await User.find({
    ...tenantFilter(companyId, isSuperAdmin),
    status: "Active",
  })
    .select("name email role")
    .sort({ name: 1 })
    .limit(200)
    .lean();
  return users.map((u) => ({
    _id: u._id.toString(),
    name: u.name,
    email: u.email || "",
    role: u.role,
  }));
}

export default async function AdvanceCreatePage() {
  const session = await auth();
  const role = session?.user?.role;
  const [projects, onBehalfOptions] = await Promise.all([
    getActiveProjects(),
    getOnBehalfOptions(role),
  ]);
  return (
    <AdvanceRequestForm
      projects={projects}
      onBehalfOptions={onBehalfOptions}
      currentUserId={session?.user?.id || ""}
    />
  );
}

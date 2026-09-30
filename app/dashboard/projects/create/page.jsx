import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { searchParties } from "@/app/db/actions/party-actions";
import { getUsers } from "@/app/db/actions/user-actions";
import { getProjectTypes } from "@/app/db/actions/project-actions";
import { PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import ProjectDataSheet from "../components/ProjectDataSheet";

export const metadata = {
  title: "Create Project | ERP System",
  description: "Create a new project",
};

export default async function CreateProjectPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!roleAllowed(session.user.role, PROJECT_MANAGE_ROLES)) {
    redirect("/dashboard/projects");
  }

  const [clients, users, projectTypes] = await Promise.all([
    searchParties("", "customer"),
    getUsers(),
    getProjectTypes(),
  ]);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6 max-w-7xl mx-auto">
      <ProjectDataSheet clients={clients} users={users} projectTypes={projectTypes} />
    </div>
  );
}

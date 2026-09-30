import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import {
  getProjectById,
  getProjectTypes,
} from "@/app/db/actions/project-actions";
import { searchParties } from "@/app/db/actions/party-actions";
import { getUsers } from "@/app/db/actions/user-actions";
import { PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import ProjectDataSheet from "../../components/ProjectDataSheet";

export const metadata = {
  title: "Edit Project | ERP System",
};

export default async function EditProjectPage({ params }) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user) redirect("/login");

  if (!roleAllowed(session.user.role, PROJECT_MANAGE_ROLES)) {
    redirect("/dashboard/projects");
  }

  const [project, clients, users, projectTypes] = await Promise.all([
    getProjectById(id),
    searchParties("", "customer"),
    getUsers(),
    getProjectTypes(),
  ]);

  if (!project) notFound();

  if (project.status === "closed") {
    redirect(`/dashboard/projects/${id}`);
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6 max-w-4xl mx-auto">
      <ProjectDataSheet clients={clients} users={users} projectTypes={projectTypes} project={project} />
    </div>
  );
}

import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import {
  getProjectById,
  getProjectsForParentPicker,
  getProjectTypes,
} from "@/app/db/actions/project-actions";
import { searchParties } from "@/app/db/actions/party-actions";
import { getUsers } from "@/app/db/actions/user-actions";
import { PARTY_MANAGE_ROLES, PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";
import ProjectForm from "../../components/ProjectForm";

export const metadata = {
  title: "Edit Project | ERP System",
};

export default async function EditProjectPage({ params }) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user) redirect("/login");

  if (!PROJECT_MANAGE_ROLES.includes(session.user.role)) {
    redirect("/dashboard/projects");
  }

  const [project, clients, users, parentProjects, projectTypes] = await Promise.all([
    getProjectById(id),
    searchParties("", "customer"),
    getUsers(),
    getProjectsForParentPicker(id),
    getProjectTypes(),
  ]);

  if (!project) notFound();

  if (project.status === "closed") {
    redirect(`/dashboard/projects/${id}`);
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6 max-w-4xl mx-auto">
      <ProjectForm canCreateClient={PARTY_MANAGE_ROLES.includes(session?.user?.role)} clients={clients} users={users} parentProjects={parentProjects} projectTypes={projectTypes} project={project} />
    </div>
  );
}

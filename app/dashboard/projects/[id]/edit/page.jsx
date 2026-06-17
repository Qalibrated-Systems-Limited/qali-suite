import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { getProjectById, getProjectsForParentPicker } from "@/app/mongodb/queries/projectQueries";
import { searchParties, getUsers } from "@/app/mongodb/queries/partyQueries";
import { PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";
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

  const [project, clients, users, parentProjects] = await Promise.all([
    getProjectById(id),
    searchParties("", "customer"),
    getUsers(),
    getProjectsForParentPicker(id),
  ]);

  if (!project) notFound();

  if (project.status === "closed") {
    redirect(`/dashboard/projects/${id}`);
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <ProjectForm clients={clients} users={users} parentProjects={parentProjects} project={project} />
    </div>
  );
}

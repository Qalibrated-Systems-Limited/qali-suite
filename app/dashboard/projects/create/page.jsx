import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { searchParties, getUsers } from "@/app/mongodb/queries/partyQueries";
import { getProjectsForParentPicker } from "@/app/mongodb/queries/projectQueries";
import ProjectForm from "../components/ProjectForm";

export const metadata = {
  title: "Create Project | ERP System",
  description: "Create a new project",
};

export default async function CreateProjectPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!["SuperAdmin", "Admin", "Accountant", "Manager"].includes(session.user.role)) {
    redirect("/dashboard/projects");
  }

  const [clients, users, parentProjects] = await Promise.all([
    searchParties("", "customer"),
    getUsers(),
    getProjectsForParentPicker(),
  ]);

  return (
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <ProjectForm clients={clients} users={users} parentProjects={parentProjects} />
    </div>
  );
}

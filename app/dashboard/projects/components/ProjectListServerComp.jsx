import { searchProjects } from "@/app/mongodb/queries/projectQueries";
import ProjectListWithFilters from "./ProjectListWithFilters";

export default async function ProjectListServerComp({ params }) {
  const query = params?.query || "";
  const status = params?.status || "all";
  const currentPage = Number(params?.page) || 1;

  const filters = { status };
  const projects = await searchProjects(query, currentPage, filters);

  return (
    <ProjectListWithFilters projects={projects} currentStatus={status} />
  );
}

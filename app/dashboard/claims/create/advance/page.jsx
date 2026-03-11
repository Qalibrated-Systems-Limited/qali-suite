import { AdvanceRequestForm } from "../../components/AdvanceRequestForm";
import { getActiveProjects } from "@/app/mongodb/queries/projectQueries";

export default async function AdvanceCreatePage() {
  const projects = await getActiveProjects();
  return <AdvanceRequestForm projects={projects} />;
}

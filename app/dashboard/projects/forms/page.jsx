import { redirect } from "next/navigation";

/**
 * The Forms Register was sixteen hardcoded strings with a disabled button and
 * a badge admitting digital submission had not been built. It is now a
 * reference panel on the Engineer's Instructions page, which is where the four
 * forms that DO exist as records live. See PROJECTS-QALITRACK-PLAN.md §10.3.
 *
 * The route stays as a redirect rather than being deleted, so no saved link
 * breaks.
 */
export default async function FormsRedirect({ searchParams }) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp?.project) params.set("project", sp.project);
  const q = params.toString();
  redirect(`/dashboard/projects/instructions${q ? `?${q}` : ""}`);
}

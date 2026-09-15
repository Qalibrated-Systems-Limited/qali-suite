import { getWorkspaceContext } from "../lib/workspace";
import WorkspaceHeader from "../components/WorkspaceHeader";
import NoProjectsCard from "../components/NoProjectsCard";
import AccessDenied from "../components/AccessDenied";
import ProjectTimesheets from "../components/ProjectTimesheets";
import ProjectTeam from "../components/ProjectTeam";
import {
  getProjectTimesheets,
  getProjectLabourSummary,
  getProjectAssignments,
  getProjectTasks,
} from "@/app/db/actions/project-actions";
import { getEmployees, getSuppliers } from "@/app/db/actions/party-actions";
import { hasRole, PROJECT_MANAGE_ROLES } from "@/lib/utils/role-gates";

/**
 * Time booked to a job — 0089 — as a SECTION rather than a card.
 *
 * The screen already existed. It rendered ninth down the project detail page,
 * below the financial summary and the team roster, reachable only by opening a
 * project and scrolling: the module's answer to "where do I put the hours" was
 * somewhere nobody looked. A section that closes the largest cost hole in the
 * module cannot be the hardest one to find.
 *
 * It is the same component the detail page renders, with the same props from
 * the same four reads — not a second implementation. The card stays where it
 * is; this is a door to it, not a copy of it.
 *
 * NOT TYPE-GATED — see `sectionsFor` in ../lib/sections.js. Every project type
 * has labour.
 */
export const metadata = {
  title: "Timesheets | Projects",
  description: "Hours and days booked against a project",
};

export default async function ProjectTimesheetsPage({ searchParams }) {
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(sp, { section: "timesheets" });
  if (ctx.denied) return <AccessDenied />;

  const { projects, project, user } = ctx;

  /**
   * The roster is the person list, because the roster carries the rate; the
   * task list is optional, because time booked to a job with no WBS is still
   * time. Both are read here so the form can offer them — the same four reads
   * `TimesheetsCard` does on the detail page.
   */
  const [entries, summary, members, tasks, employees, suppliers] = project
    ? await Promise.all([
        getProjectTimesheets(project.id, { limit: 50 }),
        getProjectLabourSummary(project.id),
        getProjectAssignments(project.id),
        getProjectTasks(project.id),
        getEmployees(),
        getSuppliers(),
      ])
    : [[], null, [], [], [], []];

  /**
   * Who may be added to the roster — employees AND suppliers, the same two
   * lists the project record offers, because a subcontractor doing the work
   * belongs on the job's roster as much as an employee does. A supplier's line
   * still costs the job nothing here: their bill already carries it (0089).
   */
  const parties = [
    ...(employees || []).map((p) => ({ _id: p._id, name: p.name, type: "employee" })),
    ...(suppliers || []).map((p) => ({ _id: p._id, name: p.name, type: "supplier" })),
  ];
  const canManage = hasRole(user, PROJECT_MANAGE_ROLES);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      <WorkspaceHeader
        title="Timesheets"
        description="Hours and days booked against this job, and what that labour cost it."
        project={project}
        projects={projects}
      />

      {!project && (
        <NoProjectsCard
          notFound={ctx.notFound}
          unselected={ctx.unselected}
          requestedId={sp?.project}
        />
      )}

      {project && (
        <>
          <ProjectTimesheets
            projectId={project.id}
            entries={entries}
            summary={summary}
            members={members}
            tasks={tasks}
            canManage={canManage}
            readOnly={project.status === "closed"}
          />

          {/*
            THE ROSTER, BENEATH THE TIMESHEET THAT DEPENDS ON IT.

            A timesheet line is booked against an ASSIGNMENT, not against a
            person — the assignment is what carries the rate, and the rate is
            what makes the labour cost true. So on a project with an empty
            roster this page could show you nothing and offer you nothing, and
            the only way to fix that was to leave for the project record and
            scroll to the Team card.

            The same component the project record renders, with the same
            writes. Putting it here is not a second roster; it is the roster,
            shown where the thing that needs it lives.
          */}
          <ProjectTeam
            projectId={project.id}
            members={members}
            parties={parties}
            canManage={canManage && project.status !== "closed"}
          />
        </>
      )}
    </div>
  );
}

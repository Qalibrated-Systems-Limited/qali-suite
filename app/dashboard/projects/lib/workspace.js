import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeProjectsNav } from "@/lib/permissions";
import {
  getProjectsForWorkspace,
  getProjectById,
} from "@/app/db/actions/project-actions";

/**
 * Shared context for the eight project-scoped module pages (Milestone
 * Tracker, Programme, Engineer's Instructions, Site Diary, Forms Register,
 * IPC & Payments, Cash Requisitions, Monthly Report).
 *
 * Each of those pages needs the same three things before it can render:
 * an authenticated + authorized session, the list of projects to offer in
 * the switcher, and which one is currently selected (from `?project=`, or
 * the first project when nothing is selected yet). Centralising it here
 * keeps that resolution — and the plan-gate-mirroring role check the list
 * page already does on its own — in one place instead of copied eight times.
 *
 * EVERY PROJECT, not just the live ones. This used `getActiveProjects()` —
 * `status IN ('planning','active')` — which is correct for a picker on a new
 * invoice and wrong here: a site diary and an instruction register are read
 * most AFTER a job finishes, for the final account or a dispute. Filtering to
 * live jobs made the records of every completed one unreachable.
 *
 * ── The `?project=` that names nothing ──────────────────────────────────────
 *
 * A bookmarked link to a project this tenant does not have resolves to NO
 * project and says so. It used to fall through to `projects[0]` silently,
 * which meant the page rendered another project's records under the right
 * page title — a wrong answer that looks right, which is worse than an empty
 * one. An earlier pass computed `notFound` for exactly this and left the
 * fallback in place beside it, so the flag was written and never read; the
 * fallback is gone here and every page renders the flag.
 *
 * The id is checked against the tenant's OWN list rather than with a second
 * `getProjectById` round trip. `listProjectsForWorkspace` is unfiltered — RLS
 * scopes it and nothing else does — so membership in that list IS the
 * question "does this tenant have this project", answered by a list the page
 * has already paid for.
 *
 * ── `detail` ───────────────────────────────────────────────────────────────
 *
 * The switcher rows carry `id`, `projectNumber`, `name` and `status`, which
 * is everything `WorkspaceHeader` renders and everything six of the eight
 * pages ever read off the project. `getProjectById` additionally computes the
 * live actuals, the effective budget and the WBS roll-up — three aggregate
 * passes over invoices, bills, claims, expenses, stock requests and tasks.
 * Only IPC & Payments (`contractValue`) and Programme (`startDate`,
 * `endDate`) need a field that is not in the list row, so only those two ask
 * for it. The Forms Register — a static reference table — was paying for a
 * full financial aggregation on every render.
 */
export async function getWorkspaceContext(searchParams, { detail = false } = {}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { user } = session;

  if (!canSeeProjectsNav(user.role)) {
    return { denied: true, user, projects: [], project: null, notFound: false };
  }

  const projects = await getProjectsForWorkspace();

  const requestedId = searchParams?.project;
  const requested = requestedId
    ? projects.find((p) => p.id === requestedId) ?? null
    : null;

  /** The link named a project that is gone, or was never this tenant's. */
  const notFound = Boolean(requestedId && !requested);

  const summary = notFound ? null : requested ?? projects[0] ?? null;
  const project =
    summary && detail ? await getProjectById(summary.id) : summary;

  return { denied: false, user, projects, project, notFound };
}

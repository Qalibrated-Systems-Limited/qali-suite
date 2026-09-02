/**
 * Which sections a project shows, and which project a page is showing.
 *
 * PURE, and deliberately in its own module: `workspace.js` imports `@/auth` and
 * is server-only, while `ProjectsNav` is a client component — and both need the
 * same two rules. The one thing worse than a rule stated twice is a rule stated
 * twice that drifts, which is how a `?project=` came to be resolved one way by
 * the page and another by the fallback beside it.
 */

/**
 * Where the switcher records the current project.
 *
 * A cookie rather than server state because a SERVER COMPONENT CANNOT SET
 * COOKIES — a value written during an RSC render is never persisted, the same
 * thing that made the session-refresh throttle an in-process map. The switcher
 * is a client component, so it writes it there and `getWorkspaceContext` reads
 * it when the URL is silent.
 *
 * Declared HERE rather than in `workspace.js` because that module imports
 * `next/headers` and `@/auth` and is server-only; a client component importing
 * the constant from there would drag both into the browser bundle.
 */
export const SELECTED_PROJECT_COOKIE = "project.selected";

/**
 * The module's sections, in nav order, and the flag on `project_types` that
 * decides whether each appears.
 *
 * Dashboard is not here: it is the module itself and every project has one.
 * `key` matches the column name in 0082 minus the `shows_` prefix.
 */
export const SECTIONS = [
  { key: "boq", href: "/dashboard/projects/boq", label: "Bill of Quantities" },
  { key: "programme", href: "/dashboard/projects/programme", label: "Programme" },
  { key: "instructions", href: "/dashboard/projects/instructions", label: "Engineer's Instructions" },
  { key: "diary", href: "/dashboard/projects/diary", label: "Site Diary" },
  { key: "certificates", href: "/dashboard/projects/ipc", label: "IPC & Payments" },
  { key: "cashRequisitions", href: "/dashboard/projects/cash-requisitions", label: "Cash Requisitions" },
];

/** Everything on — what a project with no type gets, and the safe default. */
export const ALL_SECTIONS = Object.freeze(
  Object.fromEntries(SECTIONS.map((s) => [s.key, true])),
);

/**
 * The section flags for one workspace row.
 *
 * A project with NO TYPE shows everything (0082 decision 4): the type is a
 * narrowing a tenant opts into, not a wall that arrives with a deploy. The same
 * is true of a row this function has never seen — an unknown shape shows more
 * rather than less, because a hidden section is indistinguishable from a
 * section that was never built.
 */
export function sectionsFor(project) {
  if (!project) return ALL_SECTIONS;
  return {
    boq: project.showsBoq !== false,
    programme: project.showsProgramme !== false,
    instructions: project.showsInstructions !== false,
    diary: project.showsDiary !== false,
    certificates: project.showsCertificates !== false,
    cashRequisitions: project.showsCashRequisitions !== false,
  };
}

/**
 * Which project a `?project=` names — THE rule, stated once.
 *
 * Returns `{ project, notFound }`. A `?project=` naming something this tenant
 * does not have resolves to NO project and says so; it does NOT fall through to
 * the first one. That fallback is why a bookmarked link to a completed job's
 * diary once opened a different project's diary under the right page title, and
 * a wrong answer that looks right is worse than an empty one.
 *
 * Membership of the list IS the question "does this tenant have this project":
 * `listProjectsForWorkspace` is unfiltered and RLS scopes it, so no second
 * round trip is needed to find out.
 */
export function selectProject(projects, requestedId) {
  const list = projects ?? [];
  if (requestedId) {
    const match = list.find((p) => p.id === requestedId) ?? null;
    return { project: match, notFound: !match, unselected: false };
  }

  /**
   * NOTHING CHOSEN — and this is where it used to GUESS.
   *
   * It returned `list[0]`, so arriving at a section without having picked
   * anything showed whichever job sorts first among the live ones. From the
   * dashboard — which lists every project — clicking Bill of Quantities landed
   * you on a bill you did not choose, titled as though you had.
   *
   * With ONE project there is no decision to make, so it is selected. With
   * more than one there is, and the honest answer is to ask: `unselected` is a
   * different state from "this tenant has no projects" and from "the link
   * named one that does not exist", and the three read differently on screen.
   */
  if (list.length === 1) {
    return { project: list[0], notFound: false, unselected: false };
  }
  return { project: null, notFound: false, unselected: list.length > 1 };
}

/**
 * The project a URL is already about.
 *
 * `/dashboard/projects/<uuid>` IS a project context — the detail page, its
 * edit form, its budget. Reading it means that opening a project from the
 * dashboard and then clicking a section carries that project, instead of
 * dropping back to "nothing chosen".
 */
const UUID_SEGMENT =
  /^\/dashboard\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

export function projectIdFromPath(pathname) {
  return UUID_SEGMENT.exec(pathname ?? "")?.[1] ?? null;
}

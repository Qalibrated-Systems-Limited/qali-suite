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

/**
 * The module's sections, in nav order, and the flag on `project_types` that
 * decides whether each appears.
 *
 * Dashboard is not here: it is the module itself and every project has one.
 * `key` matches the column name in 0082 minus the `shows_` prefix.
 */
export const SECTIONS = [
  { key: "boq", href: "/dashboard/projects/boq", label: "Bill of Quantities" },
  { key: "methodology", href: "/dashboard/projects/methodology", label: "Methodology" },
  { key: "milestones", href: "/dashboard/projects/milestones", label: "Milestones" },
  { key: "programme", href: "/dashboard/projects/programme", label: "Programme" },
  { key: "instructions", href: "/dashboard/projects/instructions", label: "Engineer's Instructions" },
  { key: "diary", href: "/dashboard/projects/diary", label: "Site Diary" },
  { key: "timesheets", href: "/dashboard/projects/timesheets", label: "Timesheets" },
  { key: "certificates", href: "/dashboard/projects/ipc", label: "IPC & Payments" },
  { key: "variations", href: "/dashboard/projects/variations", label: "Variations" },
  { key: "contract", href: "/dashboard/projects/contract", label: "Contract" },
  { key: "costs", href: "/dashboard/projects/costs", label: "Cost Lines" },
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
    /**
     * The implementation method statement follows the same jobs the bill does —
     * a project that has a priced bill has works to plan a method for. No
     * `shows_methodology` column; it rides the BOQ flag rather than a migration.
     */
    methodology: project.showsBoq !== false,
    /**
     * NO `shows_milestones` COLUMN, and none is needed. A milestone exists to
     * be valued and to release retention, and both happen on a certificate —
     * so a type with nothing to certify has no stages to bill, and the section
     * follows the flag that already answers that question. 0093 gave
     * milestones a table; §10.3's reason for folding the tracker away ("it did
     * not show milestones, because there is no milestone table") went with it.
     */
    milestones: project.showsCertificates !== false,
    programme: project.showsProgramme !== false,
    instructions: project.showsInstructions !== false,
    diary: project.showsDiary !== false,
    /**
     * NOT TYPE-GATED, deliberately — there is no `shows_timesheets` column.
     *
     * Every one of the other five is a construction document a supply-only job
     * genuinely does not produce. Labour is not: whoever does the work is on
     * somebody's clock, and a job whose hours reach no project reports a margin
     * it does not have — the hole 0089 exists to close. A flag here would let a
     * tenant switch off the one section that makes their cost true.
     */
    timesheets: true,
    certificates: project.showsCertificates !== false,
    // Money-in and reporting screens follow the same flags: variations move the
    // certified contract sum, cost lines are the budget's actuals.
    variations: project.showsCertificates !== false,
    contract: project.showsCertificates !== false,
    costs: project.showsBoq !== false,
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
   * IT THEN KEPT GUESSING FOR A TENANT WITH ONE PROJECT, on the reasoning that
   * with one there is no decision to make. There is no decision, but there is
   * still a claim: opening Bill of Quantities from the global sidebar, having
   * chosen nothing, put a project's name in the header as though it had been
   * selected. On a tenant whose single project is "Otho Road construction
   * project", that is indistinguishable from the bug above — and it is why
   * removing the remembered-project cookie did not fix it on its own.
   *
   * So nothing is selected until something says which. `unselected` is a
   * different state from "this tenant has no projects" and from "the link
   * named one that does not exist", and the three read differently on screen;
   * with a single project the card that asks is a one-click list of one.
   */
  return { project: null, notFound: false, unselected: list.length > 0 };
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

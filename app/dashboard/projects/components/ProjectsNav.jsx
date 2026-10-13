"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  FileEdit,
  BookOpen,
  Receipt,
  Wallet,
  Ruler,
  Clock,
  Flag,
  ClipboardList,
  Coins,
  ArrowLeft,
  ScrollText,
  Shuffle,
  ListChecks,
  Lock,
  Check,
  FolderOpen,
} from "lucide-react";
import {
  SECTIONS,
  selectProject,
  sectionsFor,
  projectIdFromPath,
} from "../lib/sections";
import { computeLifecycle, PHASES, PHASE_OF_SECTION } from "../lib/phases";

/**
 * Module-level sub-navigation for the Projects module — same pattern as HRNav
 * (app/dashboard/hr/components/HRNav.jsx): a sticky strip rendered once in the
 * module layout, above every page under /dashboard/projects/*.
 *
 * EIGHT ENTRIES, DOWN FROM TEN, AND FEWER THAN EIGHT ON MOST PROJECTS.
 *
 * Two rules got it there and they are different rules. **A nav entry must own
 * records**: of the original ten, Milestone Tracker and Programme were two
 * views of `project_tasks` beside the Work breakdown card on the project page —
 * one table, three doors — and the Milestone Tracker did not show milestones,
 * because there is no milestone table. Forms Register was sixteen hardcoded
 * strings. Monthly Report is a rendering of four other sections, which makes it
 * something you produce, not somewhere you go. All three folded in; their routes
 * still resolve as redirects, so no saved link breaks.
 *
 * **And a section appears only where the project needs it** — 0082. A
 * supply-only job has no site diary and nothing to certify, and no standard says
 * it should. The type chooses the defaults; a project with no type shows
 * everything, so nothing disappeared from anybody's screen when the column
 * arrived.
 *
 * WHY THE FLAGS ARE PASSED IN. A layout does not receive `searchParams`, so it
 * cannot know which project is selected — but it can hand over every project's
 * flags and let this component apply `selectProject`, which is the same rule the
 * pages use, from the same module. See PROJECTS-QALITRACK-PLAN.md §10.3 and §7.
 *
 * MILESTONES TOOK IT TO NINE, and on the same rule that removed it. The cut
 * above says the Milestone Tracker went because it "did not show milestones,
 * because there is no milestone table" — 0093 built the table, so it owns
 * records now and the rule that excluded it admits it. It is also second in
 * the MD's own sidebar, and on an installation contract the schedule IS the
 * valuation method. The register still renders on IPC & Payments as well:
 * there to consult while certifying, here to build and maintain.
 *
 * TIMESHEETS TOOK IT BACK TO EIGHT, and it passes both rules. It owns
 * `project_timesheets` — its own table, not a second view of somebody else's —
 * and it is the one section no project type may switch off, because every job
 * has labour and a job whose hours reach no project reports a margin it does
 * not have. It existed before this as a card ninth down the project detail
 * page: built, working, and findable only by somebody who already knew it was
 * there.
 *
 * IPC & Payments and Cash Requisitions still run the identical pair of queries.
 * Whether they are one section or two is a product decision for their author,
 * not a review finding — §7 open question 1.
 */
const ICONS = {
  boq: Ruler,
  methodology: ClipboardList,
  milestones: Flag,
  programme: CalendarDays,
  instructions: FileEdit,
  diary: BookOpen,
  timesheets: Clock,
  certificates: Receipt,
  variations: Shuffle,
  contract: ScrollText,
  costs: ListChecks,
  cashRequisitions: Wallet,
  documents: FolderOpen,
};

/**
 * "Overview", not "Dashboard".
 *
 * Every module in this app hangs off /dashboard, so a tab called Dashboard
 * inside one of them names the thing it is already inside. With no project
 * chosen it is the project REGISTER plus its totals — the portfolio overview;
 * once a project is open it is THAT project's page, and "‹ All projects" is
 * the way back to the register.
 */
export default function ProjectsNav({ projects = [] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * `?project=` first; then the project the URL is already about, so opening
   * one from the dashboard and clicking a section carries THAT project; then
   * whatever the switcher last remembered, so the sections do not vanish when
   * you click from one section to the next.
   *
   * `selectProject` validates whichever id wins against the tenant's own list,
   * so a stale cookie resolves to nothing rather than to somebody else's job.
   */
  /**
   * THE URL, AND ONLY THE URL — `?project=` first, then the project the path
   * is already about, so opening one from the dashboard and clicking a section
   * carries THAT project.
   *
   * There used to be a third fallback: a cookie the switcher wrote with a
   * year's max-age. It was added when these links were bare and the sections
   * vanished after one click; they carry `?project=` now, so the URL does that
   * job. What the cookie still did was make the tabs appear for a project
   * nobody had opened — on the dashboard, and on any section reached from the
   * global sidebar — naming a job chosen days ago.
   *
   * `selectProject` validates whichever id wins against the tenant's own list,
   * so an id from a stale link resolves to nothing rather than to somebody
   * else's job.
   */
  const { project } = selectProject(
    projects,
    searchParams.get("project") ?? projectIdFromPath(pathname),
  );
  const sections = sectionsFor(project);

  /**
   * EVERY SECTION LINK CARRIES THE SELECTED PROJECT.
   *
   * The switcher sets `?project=` and pushes; these links did not carry it, so
   * moving from the Bill of Quantities to the Site Diary dropped the parameter
   * and `getWorkspaceContext` fell back to `projects[0]` — whichever job sorts
   * first among the live ones. You arrived at the right page showing a
   * DIFFERENT project, with nothing on screen saying so.
   *
   * That is the same failure the `?project=` bookmark fix addressed, on the
   * path nobody had checked: a wrong answer that looks right.
   *
   * The Dashboard is the project LIST and is not project-scoped, so it is left
   * bare.
   */
  /**
   * THE SECTIONS APPEAR ONCE THERE IS A PROJECT.
   *
   * Every one of them shows a single project's records, so offering them with
   * nothing chosen is offering a question the page cannot answer — and until
   * `selectProject` stopped guessing, clicking one silently picked whichever
   * job sorted first. Hiding them keeps the dashboard to what the dashboard is
   * about: the list.
   *
   * The route in is the list itself. Open a project and the nav reads its id
   * out of the path, so the sections appear already pointed at it. On a section
   * page reached without a project — a bookmark, say — the switcher is still in
   * the header above, which is where the "Choose a project" card points.
   *
   * This is the same rule as the type gate one level up: a section shows when
   * it has something to show.
   */
  /**
   * ONE WORKSPACE PER PROJECT.
   *
   * With nothing chosen, the only tab is the portfolio Overview — the register.
   * Open a project and the tabs become THAT project's: its own Overview page
   * (`/dashboard/projects/<id>`, the rich page with financials, team and the
   * setup checklist), its Budget, and the type's sections. Budget was reachable
   * only as a button on the overview before, which is why people lost it; it is
   * a step in the process, so it earns a tab.
   */
  const inProject = Boolean(project);
  const projectHome = inProject
    ? `/dashboard/projects/${project.id}`
    : "/dashboard/projects";

  /**
   * THE LIFECYCLE GATE. A section's tab is locked until its phase unlocks, and a
   * phase unlocks only when the one before it is done (lib/phases.js). The flags
   * it reads ride on the project row from the workspace query, so this is a pure
   * client computation — no round trip.
   */
  const lifecycle = inProject ? computeLifecycle(project) : null;

  const rawItems = [
    {
      label: "Overview",
      sectionKey: "overview",
      href: projectHome,
      match: projectHome,
      icon: LayoutDashboard,
      exact: true,
    },
    ...(inProject
      ? [
          {
            label: "Budget",
            sectionKey: "budget",
            href: `${projectHome}/budget`,
            match: `${projectHome}/budget`,
            icon: Coins,
          },
        ]
      : []),
    ...(inProject
      ? SECTIONS.filter((s) => sections[s.key]).map((s) => ({
          label: s.label,
          sectionKey: s.key,
          href: `${s.href}?project=${project.id}`,
          // The active check compares paths, so it must not see the query string.
          match: s.href,
          icon: ICONS[s.key],
        }))
      : []),
  ].map((it) => ({
    ...it,
    phase: PHASE_OF_SECTION[it.sectionKey] ?? "setup",
    locked: lifecycle ? lifecycle.isSectionLocked(it.sectionKey) : false,
  }));

  const renderTab = (item) => {
    const path = item.match ?? item.href;
    const active = item.exact
      ? pathname === path
      : pathname === path || pathname.startsWith(path + "/");
    const Icon = item.icon;

    if (item.locked) {
      const needs = lifecycle?.labelOfPhase(item.phase);
      return (
        <span
          key={item.match ?? item.href}
          title={`Locked — finish ${needs ? `the ${needs} step` : "the previous step"} first`}
          className="flex cursor-not-allowed items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-sm text-muted-foreground/40"
        >
          <Lock className="h-3.5 w-3.5" />
          {item.label}
        </span>
      );
    }

    return (
      <Link
        key={item.match ?? item.href}
        href={item.href}
        className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${
          active
            ? "border-primary font-medium text-primary"
            : "border-transparent text-muted-foreground hover:text-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav className="sticky top-14 z-10 border-b border-border bg-card">
      <div className="flex items-center gap-1 overflow-x-auto px-4 sm:px-6 py-0">
        {inProject && (
          <>
            <Link
              href="/dashboard/projects"
              className="flex items-center gap-1.5 whitespace-nowrap px-2 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              All projects
            </Link>
            <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
          </>
        )}

        {/* No project chosen — just the portfolio Overview tab. */}
        {!inProject && rawItems.map(renderTab)}

        {/* In a project — tabs grouped by lifecycle phase, each with a small
            numbered label, and locked until its phase unlocks. */}
        {inProject &&
          PHASES.filter((p) => p.key !== "close").map((phase) => {
            // Tabs follow the phase's own section order (phases.js) — the order
            // of the setup checklist — not the raw SECTIONS order.
            const phaseItems = rawItems
              .filter((it) => it.phase === phase.key)
              .sort(
                (a, b) =>
                  phase.sections.indexOf(a.sectionKey) -
                  phase.sections.indexOf(b.sectionKey),
              );
            if (phaseItems.length === 0) return null;
            const step = lifecycle?.steps.find((s) => s.key === phase.key);
            return (
              <Fragment key={phase.key}>
                <span
                  className={`ml-1 flex shrink-0 items-center gap-1 whitespace-nowrap pl-2 text-[10px] font-semibold uppercase tracking-wider ${
                    step?.current
                      ? "text-primary"
                      : step?.done
                        ? "text-emerald-600 dark:text-emerald-400"
                        : step?.unlocked
                          ? "text-muted-foreground/70"
                          : "text-muted-foreground/40"
                  }`}
                >
                  {step?.done ? (
                    <Check className="h-3 w-3" />
                  ) : !step?.unlocked ? (
                    <Lock className="h-3 w-3" />
                  ) : (
                    <span>{phase.num}</span>
                  )}
                  {phase.label}
                </span>
                {phaseItems.map(renderTab)}
              </Fragment>
            );
          })}
      </div>
    </nav>
  );
}

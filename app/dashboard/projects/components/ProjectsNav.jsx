"use client";

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
} from "lucide-react";
import {
  SECTIONS,
  selectProject,
  sectionsFor,
  projectIdFromPath,
} from "../lib/sections";

/**
 * Module-level sub-navigation for the Projects module — same pattern as HRNav
 * (app/dashboard/hr/components/HRNav.jsx): a sticky strip rendered once in the
 * module layout, above every page under /dashboard/projects/*.
 *
 * SEVEN ENTRIES, DOWN FROM TEN, AND FEWER THAN SEVEN ON MOST PROJECTS.
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
 * IPC & Payments and Cash Requisitions still run the identical pair of queries.
 * Whether they are one section or two is a product decision for their author,
 * not a review finding — §7 open question 1.
 */
const ICONS = {
  boq: Ruler,
  programme: CalendarDays,
  instructions: FileEdit,
  diary: BookOpen,
  certificates: Receipt,
  cashRequisitions: Wallet,
};

const DASHBOARD = {
  label: "Dashboard",
  href: "/dashboard/projects",
  icon: LayoutDashboard,
  exact: true,
};

export default function ProjectsNav({ projects = [], rememberedProjectId = null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * `?project=` first; then the project the URL is already about, so opening
   * one from the dashboard and clicking a section carries THAT project; then
   * whatever the switcher last remembered, so the sections do not vanish when
   * you step back to the dashboard.
   *
   * `selectProject` validates whichever id wins against the tenant's own list,
   * so a stale cookie resolves to nothing rather than to somebody else's job.
   */
  const { project } = selectProject(
    projects,
    searchParams.get("project") ??
      projectIdFromPath(pathname) ??
      rememberedProjectId,
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
  const items = [
    DASHBOARD,
    ...(project ? SECTIONS.filter((s) => sections[s.key]) : []).map((s) => ({
      label: s.label,
      href: project ? `${s.href}?project=${project.id}` : s.href,
      // The active check compares paths, so it must not see the query string.
      match: s.href,
      icon: ICONS[s.key],
    })),
  ];

  return (
    <nav className="sticky top-14 z-10 border-b border-border bg-card">
      <div className="flex items-center gap-1 overflow-x-auto px-4 sm:px-6 py-0">
        {items.map((item) => {
          const path = item.match ?? item.href;
          const active = item.exact
            ? pathname === path
            : pathname === path || pathname.startsWith(path + "/");
          const Icon = item.icon;
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
        })}
      </div>
    </nav>
  );
}

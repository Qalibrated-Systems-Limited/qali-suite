import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeProjectsNav } from "@/lib/permissions";
import { fetchProjectPages } from "@/app/db/actions/project-actions";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import ProjectStats, {
  ProjectStatsSkeleton,
} from "../components/ProjectStats";
import ProjectListServerComp from "../components/ProjectListServerComp";
import ProjectsOverview, { ProjectsOverviewSkeleton } from "../components/ProjectsOverview";
import { ProjectListSkeleton } from "../components/ProjectListWithFilters";

export const metadata = {
  title: "Projects | ERP System",
  description: "Manage projects and track profitability",
};

async function ProjectsPagination({ query, filters }) {
  const totalPages = await fetchProjectPages(query, filters);
  if (totalPages <= 1) return null;
  return (
    <div className="flex justify-center mt-4">
      <Pagination totalPages={totalPages} />
    </div>
  );
}

export default async function ProjectsPage({ searchParams }) {
  const params = await searchParams;
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Plan gate
  const { checkPlanAccess } = await import("@/lib/plan-gate");
  const { UpgradePrompt } = await import("@/components/upgrade-prompt");
  const gate = await checkPlanAccess("projects");
  if (!gate.allowed) {
    return <UpgradePrompt currentPlan={gate.currentPlan} requiredPlan={gate.requiredPlan} feature="Project Management" />;
  }

  const { user } = session;

  // Single source of truth — same gate the sidebar uses. CFO and
  // Finance Manager could see the link but the previous inline allowlist
  // bounced them.
  if (!canSeeProjectsNav(user.role)) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Access Denied
          </h2>
          <p className="text-muted-foreground">
            You don&apos;t have permission to access projects.
          </p>
        </div>
      </div>
    );
  }

  const query = params?.query || "";
  const status = params?.status || "all";
  const filters = { status };

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      {/* Header. Starting a project is the module's first action, so it is
          a full, labelled button at every width — on a phone it used to
          shrink to a bare "+". */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Projects</h1>
          <p className="text-sm text-muted-foreground">
            What is happening across every project, and what is waiting on someone.
          </p>
        </div>
        <Button asChild size="lg" className="w-full bg-yellow-500 font-semibold text-black hover:bg-yellow-600 sm:w-auto">
          <Link href="/dashboard/projects/create">
            <Plus className="mr-2 h-5 w-5" />
            Start a new project
          </Link>
        </Button>
      </div>

      <Suspense fallback={<ProjectStatsSkeleton />}>
        <ProjectStats />
      </Suspense>

      {/* The overview is the module's first page: every section's pending
          work and the latest movement, each a link into that section. */}
      <Suspense fallback={<ProjectsOverviewSkeleton />}>
        <ProjectsOverview />
      </Suspense>

      {/* The register — every project, searchable — below the overview. */}
      <h2 id="all-projects" className="pt-2 text-base font-semibold text-foreground">All projects</h2>

      {/*
        SEARCH — the box that was never rendered.

        `searchProjects` has matched project number, name, client and manager
        since the port (app/db/repositories/projects.ts `filterConditions`), and
        this page has read `?query=` and passed it down the whole time. There
        was simply nothing on screen to type into, so on a tenant with more
        projects than one page the only way to reach the twenty-first was the
        pager.

        Full width and first in the reading order on a phone, where it is the
        primary way through a list: no `md:min-w-[500px]` fighting the column.
      */}
      <Search
        placeholder="Search by number, name, client or manager..."
        className="w-full min-w-0 md:min-w-0 md:max-w-xl"
      />

      {/* Project List */}
      <Suspense fallback={<ProjectListSkeleton />}>
        <ProjectListServerComp params={params} />
      </Suspense>

      {/* Pagination */}
      <Suspense fallback={null}>
        <ProjectsPagination query={query} filters={filters} />
      </Suspense>
    </div>
  );
}

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeProjectsNav } from "@/lib/permissions";
import { fetchProjectPages } from "@/app/db/actions/project-actions";
import Pagination from "@/components/pagination";
import Search from "@/components/search";
import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus, Tags, ShieldCheck } from "lucide-react";
import ProjectStats, {
  ProjectStatsSkeleton,
} from "../components/ProjectStats";
import ProjectListServerComp from "../components/ProjectListServerComp";
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
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1 sm:space-y-2 min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">
            Projects
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground hidden sm:block">
            Track project budgets, costs, and profitability
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* The cost codes page — 0073. Without a link it is unreachable, and
              a budget cannot be drafted until at least one code exists. */}
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/projects/sealed-budgets">
              <ShieldCheck className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Sealed budgets</span>
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/projects/cost-codes">
              <Tags className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Cost Codes</span>
            </Link>
          </Button>
          <Button asChild size="sm" className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold sm:size-default">
            <Link href="/dashboard/projects/create">
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">New Project</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <Suspense fallback={<ProjectStatsSkeleton />}>
        <ProjectStats />
      </Suspense>

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

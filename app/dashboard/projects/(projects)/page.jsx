import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canSeeProjectsNav } from "@/lib/permissions";
import { fetchProjectPages } from "@/app/mongodb/queries/projectQueries";
import Pagination from "@/components/pagination";
import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
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
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1 sm:space-y-2 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            Projects
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground hidden sm:block">
            Track project budgets, costs, and profitability
          </p>
        </div>
        <Button asChild size="sm" className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold shrink-0 sm:size-default">
          <Link href="/dashboard/projects/create">
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">New Project</span>
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <Suspense fallback={<ProjectStatsSkeleton />}>
        <ProjectStats />
      </Suspense>

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

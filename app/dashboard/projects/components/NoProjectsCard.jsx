import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolderKanban, Plus, SearchX } from "lucide-react";

/**
 * Shown by every project-scoped section when there is no project to show data
 * for — instead of an empty table or a chart with nothing on it.
 *
 * THREE REASONS, and they are not the same answer. `unselected` means several
 * projects exist and none has been chosen — this used to silently show the
 * first one, so arriving from the dashboard put you on a job you did not pick. `notFound` means the link
 * carried a `?project=` this tenant does not have: the company may well have a
 * dozen projects, so telling that reader "no projects yet" is false, and
 * quietly opening a different project is worse. It says which id failed and
 * points at the switcher, which is already on the page above this card.
 */
export default function NoProjectsCard({
  notFound = false,
  requestedId = null,
  unselected = false,
}) {
  if (unselected) {
    return (
      <Card className="p-8 sm:p-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <FolderKanban className="h-6 w-6 text-primary" />
        </div>
        <h2 className="font-semibold text-lg mb-1">Choose a project</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          This section shows one project at a time. Pick one from the switcher
          above — it will follow you across the other sections.
        </p>
      </Card>
    );
  }

  if (notFound) {
    return (
      <Card className="p-8 sm:p-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <SearchX className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="font-semibold text-lg mb-1">That project isn&apos;t available</h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
          The link points at a project this company doesn&apos;t have — it may have
          been deleted, or the link may have come from another company. Pick a
          project from the switcher above to carry on.
        </p>
        {requestedId && (
          <p className="font-mono text-xs text-muted-foreground/70 break-all">
            {requestedId}
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-8 sm:p-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <FolderKanban className="h-6 w-6 text-primary" />
      </div>
      <h2 className="font-semibold text-lg mb-1">No projects yet</h2>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
        Create a project to start tracking its milestones, schedule and site
        records here.
      </p>
      <Button
        asChild
        size="sm"
        className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
      >
        <Link href="/dashboard/projects/create">
          <Plus className="h-4 w-4 mr-1.5" />
          New Project
        </Link>
      </Button>
    </Card>
  );
}

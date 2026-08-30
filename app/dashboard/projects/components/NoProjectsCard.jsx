import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolderKanban, Plus } from "lucide-react";

/**
 * Shown by every project-scoped section when the company has no active
 * project to show data for yet — instead of an empty table or a chart with
 * nothing on it.
 */
export default function NoProjectsCard() {
  return (
    <Card className="p-8 sm:p-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <FolderKanban className="h-6 w-6 text-primary" />
      </div>
      <h2 className="font-semibold text-lg mb-1">No active projects yet</h2>
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

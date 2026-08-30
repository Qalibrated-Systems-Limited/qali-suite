"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { FolderKanban } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Which project the current section (Milestones, Programme, IPC & Payments,
 * etc.) is showing. Changing it keeps the page but swaps `?project=` so the
 * server component re-fetches for the new project — every section reads the
 * same query param, so switching once here follows you across the module.
 *
 * FINISHED JOBS ARE LISTED, and marked. The list used to be live projects
 * only, which made the diary and instruction register of every completed job
 * unreachable — the records people come back for during a final account or a
 * dispute. Now everything is offered, live first, and anything not live wears
 * its status so a completed job is never mistaken for a running one.
 */
export default function ProjectSwitcher({ projects, selectedId }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!projects?.length) return null;

  function handleChange(id) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("project", id);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Select value={selectedId || undefined} onValueChange={handleChange}>
      <SelectTrigger className="w-full sm:w-72 h-10 bg-background">
        <FolderKanban className="h-4 w-4 text-muted-foreground shrink-0 mr-1.5" />
        <SelectValue placeholder="Select a project" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => {
          const live = p.status === "planning" || p.status === "active";
          return (
            <SelectItem key={p.id} value={p.id}>
              <span className="font-mono text-xs text-muted-foreground mr-2">
                {p.projectNumber}
              </span>
              {p.name}
              {!live && (
                <Badge
                  variant="outline"
                  className="ml-2 text-[10px] font-normal capitalize"
                >
                  {String(p.status ?? "").replace("_", " ")}
                </Badge>
              )}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

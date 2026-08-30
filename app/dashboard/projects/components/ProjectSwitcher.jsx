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

/**
 * Which project the current section (Milestones, Programme, IPC & Payments,
 * etc.) is showing. Changing it keeps the page but swaps `?project=` so the
 * server component re-fetches for the new project — every section reads the
 * same query param, so switching once here follows you across the module.
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
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="font-mono text-xs text-muted-foreground mr-2">
              {p.projectNumber}
            </span>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

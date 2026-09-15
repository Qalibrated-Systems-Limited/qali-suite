"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FolderKanban, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Which project the current section is showing.
 *
 * A SEARCH, NOT A SCROLL. This was a `Select` listing every project, which is
 * fine for three and unusable for eighty — and a contractor's project list only
 * ever grows, because finished jobs stay in it. The codebase already argued
 * this once, on the account picker: "a scroll-and-select over 39 accounts
 * ordered by code is a search problem pretending to be a list". Same component
 * pattern, same reason.
 *
 * Typing matches the NUMBER or the NAME, because people know a job by either —
 * "RWC 772" or "Otho–Got Kachola".
 *
 * FINISHED JOBS ARE LISTED, and marked. Limiting this to live projects made the
 * diary and instruction register of every completed job unreachable, and those
 * are the records people come back for during a final account or a dispute. So
 * everything is offered, live first, and anything not live wears its status.
 *
 * Choosing writes a cookie as well as the URL: most ways into a section — the
 * sidebar, a typed address, the command palette — carry no `?project=`, and
 * without the cookie every one of them fell back to whichever job sorted first.
 */
export default function ProjectSwitcher({ projects, selectedId }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  if (!projects?.length) return null;

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const isLive = (p) => p.status === "planning" || p.status === "active";

  function choose(id) {
    setOpen(false);
    // The pushed `?project=` below is the whole record of the choice. This
    // also wrote a year-long cookie, which is what made a section opened
    // from the global sidebar days later reopen this project unasked.
    const params = new URLSearchParams(searchParams.toString());
    params.set("project", id);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full sm:w-72 h-10 justify-between bg-background font-normal"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <FolderKanban className="h-4 w-4 text-muted-foreground shrink-0" />
            {selected ? (
              <>
                <span className="font-mono text-xs text-muted-foreground shrink-0">
                  {selected.projectNumber}
                </span>
                <span className="truncate">{selected.name}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Select a project</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Search by number or name..." />
          <CommandList>
            <CommandEmpty>No project matches that.</CommandEmpty>
            <CommandGroup>
              {projects.map((p) => (
                <CommandItem
                  key={p.id}
                  /* Both fields are searchable, so either way of naming a job
                     finds it. */
                  value={`${p.projectNumber} ${p.name}`}
                  onSelect={() => choose(p.id)}
                  className="gap-2"
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      p.id === selectedId ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="font-mono text-xs text-muted-foreground shrink-0">
                    {p.projectNumber}
                  </span>
                  <span className="truncate">{p.name}</span>
                  {!isLive(p) && (
                    <Badge
                      variant="outline"
                      className="ml-auto text-[10px] font-normal capitalize shrink-0"
                    >
                      {String(p.status ?? "").replace("_", " ")}
                    </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

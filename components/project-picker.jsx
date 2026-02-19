"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, Check, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";

function getBudgetHealth(project) {
  if (!project.budget?.amount || project.budget.amount === 0) return null;
  const used =
    (project.financials?.totalCosts || 0) +
    (project.financials?.totalCommitted || 0);
  const pct = Math.round((used / project.budget.amount) * 100);
  if (pct >= 90) return { color: "text-red-500", label: `${pct}%` };
  if (pct >= 70) return { color: "text-yellow-500", label: `${pct}%` };
  return { color: "text-emerald-500", label: `${pct}%` };
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export default function ProjectPicker({
  value,
  onValueChange,
  projects,
  placeholder = "Select project...",
  className,
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? projects.find((p) => p._id === value) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-11 w-full justify-between font-normal", className)}
        >
          {selected ? (
            <span className="truncate flex items-center gap-2">
              <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-mono text-xs text-muted-foreground">
                {selected.projectNumber}
              </span>
              {selected.name}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search projects..." />
          <CommandList>
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup>
              {/* Clear option */}
              {value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onValueChange("");
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  <span className="italic">Clear selection</span>
                </CommandItem>
              )}
              {projects.map((project) => {
                const health = getBudgetHealth(project);
                return (
                  <CommandItem
                    key={project._id}
                    value={`${project.projectNumber} ${project.name}`}
                    onSelect={() => {
                      onValueChange(project._id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === project._id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {project.projectNumber}
                        </span>
                        <span className="truncate text-sm">{project.name}</span>
                      </div>
                      {project.budget?.amount > 0 && (
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span>
                            Budget: KES {formatCurrency(project.budget.amount)}
                          </span>
                          {health && (
                            <span className={health.color}>
                              {health.label} used
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createDepartmentQuick } from "@/app/db/actions/hr-department-actions";

/**
 * DepartmentCombobox
 * Searchable department selector with create-on-the-fly.
 *
 * Writes departmentId only. The NAME is no longer posted: the employee record
 * references the department, and the name is joined — so a rename reaches
 * every employee instead of leaving everyone hired before it filed under the
 * old one. See migration 0045.
 */
export default function DepartmentCombobox({ initialDepartments = [], defaultValue = null, error }) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [departments, setDepartments] = React.useState(initialDepartments);
  const [selected, setSelected] = React.useState(defaultValue); // { id, name }
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState(null);

  const filtered = departments.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase())
  );

  const showCreate =
    search.trim().length > 0 &&
    !departments.some((d) => d.name.toLowerCase() === search.toLowerCase().trim());

  function handleSelect(dept) {
    setSelected(dept.id === selected?.id ? null : dept);
    setOpen(false);
    setSearch("");
  }

  async function handleCreate() {
    const name = search.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    const result = await createDepartmentQuick(name);
    setCreating(false);
    if (!result.success) {
      setCreateError(result.error);
      return;
    }
    setDepartments((prev) => [...prev, result.department].sort((a, b) => a.name.localeCompare(b.name)));
    setSelected(result.department);
    setOpen(false);
    setSearch("");
  }

  return (
    <div>
      {/* Hidden input consumed by the parent form action */}
      <input type="hidden" name="departmentId" value={selected?.id || ""} />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal bg-background",
              !selected && "text-muted-foreground",
              error && "border-destructive focus:ring-destructive"
            )}
          >
            {selected ? selected.name : "Search or create department…"}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search departments…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {filtered.length === 0 && !showCreate && (
                <CommandEmpty>No departments found.</CommandEmpty>
              )}

              {filtered.length > 0 && (
                <CommandGroup>
                  {filtered.map((dept) => (
                    <CommandItem
                      key={dept.id}
                      value={dept.name}
                      onSelect={() => handleSelect(dept)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selected?.id === dept.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {dept.name}
                      {dept.code && (
                        <span className="ml-auto text-xs text-muted-foreground">{dept.code}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {showCreate && (
                <>
                  {filtered.length > 0 && <CommandSeparator />}
                  <CommandGroup>
                    <CommandItem
                      onSelect={handleCreate}
                      disabled={creating}
                      className="text-primary"
                    >
                      {creating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="mr-2 h-4 w-4" />
                      )}
                      {creating ? "Creating…" : `Create "${search.trim()}"`}
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {createError && <p className="mt-1 text-xs text-destructive">{createError}</p>}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

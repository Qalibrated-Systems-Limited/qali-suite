"use client";

import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

/**
 * ManagerCombobox
 * Searchable manager selector. Writes managerId (partyId) and managerName
 * as hidden form inputs consumed by the parent server action.
 */
export default function ManagerCombobox({ managers = [], defaultValue = null, error }) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  // defaultValue: { partyId, name, designation }
  const [selected, setSelected] = React.useState(defaultValue);

  const filtered = managers.filter((m) => {
    const full = `${m.personalInfo?.firstName || ""} ${m.personalInfo?.lastName || ""}`.toLowerCase();
    const desig = (m.employment?.designation || "").toLowerCase();
    const num = (m.employeeNumber || "").toLowerCase();
    const q = search.toLowerCase();
    return full.includes(q) || desig.includes(q) || num.includes(q);
  });

  function handleSelect(m) {
    const full = `${m.personalInfo?.firstName || ""} ${m.personalInfo?.lastName || ""}`.trim();
    const isSame = selected?.partyId === m.partyId;
    setSelected(isSame ? null : { partyId: m.partyId, name: full, designation: m.employment?.designation || null });
    setOpen(false);
    setSearch("");
  }

  function handleClear(e) {
    e.stopPropagation();
    setSelected(null);
  }

  return (
    <div>
      {/* Hidden inputs consumed by the form action */}
      <input type="hidden" name="managerId"   value={selected?.partyId || ""} />
      <input type="hidden" name="managerName" value={selected?.name    || ""} />

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
              error && "border-destructive"
            )}
          >
            <span className="truncate">
              {selected ? (
                <>
                  {selected.name}
                  {selected.designation && (
                    <span className="ml-1.5 text-muted-foreground font-normal text-xs">
                      — {selected.designation}
                    </span>
                  )}
                </>
              ) : (
                "Search manager…"
              )}
            </span>
            <span className="ml-2 flex items-center gap-1 shrink-0">
              {selected && (
                <X
                  className="h-3.5 w-3.5 opacity-50 hover:opacity-100"
                  onClick={handleClear}
                />
              )}
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search by name or designation…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {filtered.length === 0 ? (
                <CommandEmpty>No managers found.</CommandEmpty>
              ) : (
                <CommandGroup>
                  {filtered.map((m) => {
                    const full = `${m.personalInfo?.firstName || ""} ${m.personalInfo?.lastName || ""}`.trim();
                    const isSelected = selected?.partyId === m.partyId;
                    return (
                      <CommandItem
                        key={m._id}
                        value={full}
                        onSelect={() => handleSelect(m)}
                      >
                        <Check className={cn("mr-2 h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{full}</span>
                          {m.employment?.designation && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              — {m.employment.designation}
                            </span>
                          )}
                        </div>
                        {m.employeeNumber && (
                          <span className="ml-auto pl-2 text-xs text-muted-foreground font-mono shrink-0">
                            {m.employeeNumber}
                          </span>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

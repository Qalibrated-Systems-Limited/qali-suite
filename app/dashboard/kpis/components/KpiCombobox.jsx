"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

// ============================================
// KPI COMBOBOX
// ============================================
// Generic searchable picker built on Popover + cmdk. Designed for selects
// where:
//   - the option list is long enough to benefit from search (employees), OR
//   - each option carries extra context that's worth seeing inline (auto
//     formula descriptions).
//
// Items shape:
//   [{ value, label, description?, hint?, group? }]
// `group` is optional — when present, items are bucketed into named sections.
// `description` shows under the label in the dropdown; `hint` shows below
// the trigger when selected.
//
// Submit-friendly: renders a hidden <input name={name} value={value} /> so
// the picked value travels with normal form submission.
// ============================================

export function KpiCombobox({
  name,
  value,
  onChange,
  items = [],
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  triggerClassName,
  popoverWidth = "w-[var(--radix-popover-trigger-width)]",
  required = false,
  disabled = false,
  renderSelected, // optional: (item) => ReactNode for custom trigger label
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.value === value) || null;

  // Group by `group` field; ungrouped items collected under empty string.
  const groups = items.reduce((acc, item) => {
    const key = item.group ?? "";
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(item);
    return acc;
  }, new Map());

  return (
    <>
      {/* Hidden input so the picked value submits with the form */}
      <input type="hidden" name={name} value={value || ""} required={required} />

      <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal text-left",
              !selected && "text-muted-foreground",
              triggerClassName
            )}
          >
            <span className="truncate">
              {selected ? (renderSelected ? renderSelected(selected) : selected.label) : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className={cn("p-0", popoverWidth)} align="start">
          <Command
            // Custom filter: search across label, description, and group name
            filter={(itemValue, search) => {
              const item = items.find((i) => i.value === itemValue);
              if (!item) return 0;
              const haystack = [item.label, item.description, item.group]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              return haystack.includes(search.toLowerCase()) ? 1 : 0;
            }}
          >
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              {[...groups.entries()].map(([groupName, groupItems]) => (
                <CommandGroup key={groupName || "_"} heading={groupName || undefined}>
                  {groupItems.map((item) => (
                    <CommandItem
                      key={item.value}
                      value={item.value}
                      onSelect={() => {
                        onChange?.(item.value);
                        setOpen(false);
                      }}
                      className="items-start"
                    >
                      <Check
                        className={cn(
                          "mt-0.5 mr-2 h-4 w-4 shrink-0",
                          value === item.value ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{item.label}</div>
                        {item.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {item.description}
                          </div>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected?.hint && (
        <p className="mt-1 text-xs text-muted-foreground">{selected.hint}</p>
      )}
    </>
  );
}

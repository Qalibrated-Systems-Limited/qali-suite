"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The budget line's picker — 0073.
 *
 * DELIBERATELY HAS NO "create" AFFORDANCE. The combobox it replaces did: a
 * project manager could add a chart-of-accounts entry from inside a budget
 * line, which is the opposite of the reason cost codes sit in front of the
 * ledger at all. A code that does not exist yet is finance's to add, on the
 * cost codes page.
 *
 * The account each code charges is shown beneath it — not to be chosen, but
 * because the person approving the budget is usually the accountant, and they
 * are the one who needs to see it.
 */
export default function CostCodeCombobox({
  value,
  onValueChange,
  costCodes = [],
  taken = [],
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? costCodes.find((c) => c._id === value) : null;
  const takenSet = new Set(taken.filter(Boolean));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between font-normal text-sm"
        >
          {selected ? (
            <span className="truncate">
              <span className="font-mono text-xs mr-1">{selected.code}</span>
              {selected.name}
            </span>
          ) : (
            <span className="text-muted-foreground">Select cost code...</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search cost codes..." />
          <CommandList>
            <CommandEmpty>
              No cost codes. Finance adds them under Projects → Cost codes.
            </CommandEmpty>
            <CommandGroup>
              {costCodes.map((code) => {
                // Already on another line. Two lines against one code are two
                // halves of one number, and the database refuses the second.
                const used = takenSet.has(code._id);
                return (
                  <CommandItem
                    key={code._id}
                    value={`${code.code} ${code.name} ${code.accountCode ?? ""}`}
                    disabled={used}
                    onSelect={() => {
                      if (used) return;
                      onValueChange(code._id);
                      setOpen(false);
                    }}
                    className={cn(used && "opacity-40")}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === code._id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">
                        <span className="font-mono text-xs mr-1">{code.code}</span>
                        {code.name}
                      </span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {code.accountCode} {code.accountName}
                        {used && " — already on this budget"}
                      </span>
                    </span>
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

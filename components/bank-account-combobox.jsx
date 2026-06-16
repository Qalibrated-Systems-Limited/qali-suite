"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Landmark } from "lucide-react";
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

const SUBTYPE_LABEL = {
  bank: "Bank",
  cash: "Cash",
  mpesa: "M-Pesa",
  mobile_money: "Mobile Money",
};

// Searchable picker over ALL cash/bank-like accounts (banks, petty cash, M-Pesa)
// — including user-added ones. Search matches account code or name.
export default function BankAccountCombobox({
  value,
  onValueChange,
  accounts = [],
  placeholder = "Select account...",
  className,
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? accounts.find((a) => a._id === value) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          {selected ? (
            <span className="truncate flex items-center gap-2">
              <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-mono text-xs text-muted-foreground">
                {selected.accountCode}
              </span>
              {selected.accountName}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by code or name..." />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            <CommandGroup>
              {accounts.map((a) => (
                <CommandItem
                  key={a._id}
                  // Searchable text — cmdk filters on this value.
                  value={`${a.accountCode} ${a.accountName}`}
                  onSelect={() => {
                    onValueChange(a._id === value ? "" : a._id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === a._id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="font-mono text-xs text-muted-foreground mr-2">
                    {a.accountCode}
                  </span>
                  <span className="flex-1 truncate">{a.accountName}</span>
                  {a.subType && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {SUBTYPE_LABEL[a.subType] || a.subType}
                    </span>
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

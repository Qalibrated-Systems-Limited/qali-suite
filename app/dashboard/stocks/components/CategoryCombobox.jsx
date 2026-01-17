"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
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
 * CategoryCombobox - Searchable category selector
 */
export function CategoryCombobox({
  value,
  onChange,
  name = "category",
  placeholder = "Select category...",
  disabled = false,
  error,
  required = false,
  categories = [],
}) {
  const [open, setOpen] = React.useState(false);

  // Find selected category name
  const selectedCategory = categories.find((cat) => cat._id === value);

  // Handle selection
  const handleSelect = (categoryId) => {
    // Toggle off if same value selected
    const newValue = categoryId === value ? "" : categoryId;
    onChange?.(newValue);
    setOpen(false);
  };

  return (
    <div className="relative">
      {/* Hidden input for form submission */}
      <input type="hidden" name={name} value={value || ""} />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-required={required}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
              error && "border-red-500 focus:ring-red-500"
            )}
          >
            {selectedCategory?.name || placeholder}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search categories..." />
            <CommandList>
              <CommandEmpty>No categories found.</CommandEmpty>
              <CommandGroup>
                {categories.map((category) => (
                  <CommandItem
                    key={category._id}
                    // Use name for search filtering, _id for value
                    value={category.name}
                    onSelect={() => handleSelect(category._id)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === category._id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {/* Show indent for nested categories */}
                    {"─".repeat(category.level || 0)} {category.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
    </div>
  );
}

export default CategoryCombobox;

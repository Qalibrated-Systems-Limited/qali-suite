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
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * CategoryCombobox - Searchable category selector
 *
 * IT CAN ALSO CREATE ONE. Category is required on step one of the product
 * wizard, and the list starts empty on a new tenant — so without this the
 * first product could not be filed without abandoning the wizard, visiting
 * /dashboard/categories, and starting the form again. Typing a name that
 * matches nothing offers it as a new category, in place.
 *
 * `onCreate` is optional: the combobox is a plain picker wherever it is not
 * passed, which is what the read-only and filter uses want.
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
  onCreate,
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState("");

  // Find selected category name
  const selectedCategory = categories.find((cat) => cat._id === value);

  // Handle selection
  const handleSelect = (categoryId) => {
    // Toggle off if same value selected
    const newValue = categoryId === value ? "" : categoryId;
    const selected = categories.find((cat) => cat._id === newValue);
    onChange?.(newValue, selected ?? null);
    setOpen(false);
  };

  const typed = search.trim();
  // Case-insensitively, because "Tools" and "tools" are the same category to
  // the person typing, and offering to create the second one is a trap.
  const exists = categories.some(
    (cat) => cat.name?.trim().toLowerCase() === typed.toLowerCase(),
  );
  const canOffer = Boolean(onCreate) && typed.length >= 2 && !exists;

  const handleCreate = async () => {
    if (!canOffer || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const created = await onCreate(typed);
      if (created?._id) {
        // Selected as well as created: the point of the shortcut is that the
        // field is filled when the popover closes, not that a name exists
        // somewhere and still has to be picked.
        onChange?.(created._id, created);
        setSearch("");
        setOpen(false);
      } else {
        setCreateError(created?.error || "Could not create that category.");
      }
    } catch (e) {
      setCreateError(e?.message || "Could not create that category.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="relative">
      {/* Hidden input for form submission */}
      <input type="hidden" name={name} value={value || ""} />

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setSearch("");
            setCreateError("");
          }
        }}
      >
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
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
        >
          <Command>
            <CommandInput
              placeholder={
                onCreate ? "Search or type a new name..." : "Search categories..."
              }
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {/*
                CommandEmpty renders only when nothing matches, which is
                exactly when the create row matters most — but it is not the
                ONLY time it should appear: "Tool" matching "Tooling" is a
                match, and the user may still mean a new "Tool". So the offer
                lives in its own always-mounted group below, and the empty
                state carries the message alone.
              */}
              <CommandEmpty>
                {onCreate
                  ? "No match — type a name to create one."
                  : "No categories found."}
              </CommandEmpty>
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

              {canOffer && (
                <CommandGroup forceMount>
                  <CommandItem
                    // `forceMount` + a value that always matches the query, so
                    // Command's own filtering cannot hide the create row —
                    // it is the one item that must survive a search matching
                    // nothing.
                    forceMount
                    value={typed}
                    disabled={creating}
                    onSelect={handleCreate}
                  >
                    {creating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Create &ldquo;{typed}&rdquo;
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
          {createError && (
            <p className="border-t px-3 py-2 text-sm text-red-500">
              {createError}
            </p>
          )}
        </PopoverContent>
      </Popover>

      {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
    </div>
  );
}

export default CategoryCombobox;

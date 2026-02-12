"use client";

import { LayoutList, Table2, FolderTree } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const VIEW_OPTIONS = [
  {
    value: "timeline",
    label: "Timeline",
    icon: LayoutList,
    description: "Chronological view with date grouping",
  },
  {
    value: "table",
    label: "Table",
    icon: Table2,
    description: "Traditional table layout",
  },
  {
    value: "grouped",
    label: "Grouped",
    icon: FolderTree,
    description: "Group by type, status, or date",
  },
];

const GROUP_OPTIONS = [
  { value: "type", label: "Entry Type" },
  { value: "status", label: "Status" },
  { value: "date", label: "Date" },
];

export function JournalViewToggle({
  view,
  onViewChange,
  groupBy = "type",
  onGroupByChange,
  className,
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {/* View Mode Toggle - Desktop */}
      <div className="hidden sm:block">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) => {
            if (value) onViewChange(value);
          }}
          className="bg-muted p-1 rounded-lg"
        >
          {VIEW_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                aria-label={option.label}
                className="px-3 py-1.5 data-[state=on]:bg-background data-[state=on]:shadow-sm gap-2"
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{option.label}</span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>

      {/* View Mode Select - Mobile */}
      <div className="sm:hidden">
        <Select value={view} onValueChange={(v) => onViewChange(v)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4" />
                    <span>{option.label}</span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Group By Select (only shown when grouped view is active) */}
      {view === "grouped" && onGroupByChange && (
        <Select value={groupBy} onValueChange={(v) => onGroupByChange(v)}>
          <SelectTrigger className="w-[140px]">
            <span className="text-muted-foreground mr-1">Group:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

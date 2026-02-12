"use client";

import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Eye, CheckCircle2, RotateCcw, Loader2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { EntryTypeBadge } from "./EntryTypeBadge";
import { StatusBadge } from "./StatusBadge";

export function JournalTableView({
  entries,
  isLoading,
  onPost,
  onReverse,
  onLoadMore,
  hasMore,
  selectedIds = [],
  onSelectionChange,
}) {
  const router = useRouter();

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const toggleSelection = (id) => {
    if (!onSelectionChange) return;
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((i) => i !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const toggleAll = () => {
    if (!onSelectionChange) return;
    if (selectedIds.length === entries.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(entries.map((e) => e._id));
    }
  };

  if (entries.length === 0 && !isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No journal entries found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Desktop Table */}
      <div className="hidden md:block border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {onSelectionChange && (
                <TableHead className="w-12">
                  <Checkbox
                    checked={
                      entries.length > 0 && selectedIds.length === entries.length
                    }
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
              )}
              <TableHead className="w-32">Entry #</TableHead>
              <TableHead className="w-28">Date</TableHead>
              <TableHead className="w-28">Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-32">Party</TableHead>
              <TableHead className="w-28 text-right">Debit</TableHead>
              <TableHead className="w-28 text-right">Credit</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow
                key={entry._id}
                className={cn(
                  "cursor-pointer hover:bg-muted/50 transition-colors",
                  selectedIds.includes(entry._id) && "bg-muted/30"
                )}
                onClick={() => router.push(`/dashboard/journal/${entry._id}`)}
              >
                {onSelectionChange && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.includes(entry._id)}
                      onCheckedChange={() => toggleSelection(entry._id)}
                    />
                  </TableCell>
                )}
                <TableCell className="font-mono text-sm font-medium">
                  {entry.entryNumber}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(entry.entryDate)}
                </TableCell>
                <TableCell>
                  <EntryTypeBadge type={entry.entryType} size="sm" />
                </TableCell>
                <TableCell className="max-w-xs">
                  <p className="truncate text-sm">{entry.description}</p>
                  {entry.reference && (
                    <p className="text-xs text-muted-foreground truncate">
                      Ref: {entry.reference}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {entry.party?.name || "-"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-blue-600">
                  {formatCurrency(entry.totalDebits)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-green-600">
                  {formatCurrency(entry.totalCredits)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={entry.status} size="sm" />
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => router.push(`/dashboard/journal/${entry._id}`)}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      {entry.status === "draft" && onPost && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => onPost(entry._id)}>
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            Post Entry
                          </DropdownMenuItem>
                        </>
                      )}
                      {entry.status === "posted" && onReverse && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => onReverse(entry._id)}
                            className="text-red-600"
                          >
                            <RotateCcw className="w-4 h-4 mr-2" />
                            Reverse Entry
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {entries.map((entry) => (
          <div
            key={entry._id}
            className="border rounded-lg p-4 space-y-3 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => router.push(`/dashboard/journal/${entry._id}`)}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">
                    {entry.entryNumber}
                  </span>
                  <StatusBadge status={entry.status} size="sm" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(entry.entryDate)}
                </p>
              </div>
              <EntryTypeBadge type={entry.entryType} size="sm" />
            </div>

            <p className="text-sm line-clamp-2">{entry.description}</p>

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">DR </span>
                  <span className="font-mono text-blue-600">
                    {formatCurrency(entry.totalDebits)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">CR </span>
                  <span className="font-mono text-green-600">
                    {formatCurrency(entry.totalCredits)}
                  </span>
                </div>
              </div>
              {entry.party && (
                <span className="text-sm text-muted-foreground truncate max-w-[120px]">
                  {entry.party.name}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            onClick={onLoadMore}
            disabled={isLoading}
            className="min-w-[200px]"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              "Load More Entries"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

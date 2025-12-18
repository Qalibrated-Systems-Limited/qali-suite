"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Eye,
  MoreVertical,
  FileText,
  PackageCheck,
  TruckIcon,
} from "lucide-react";
import { ViewDeliveryNoteDialog } from "./ViewDeliveryNoteDialog";
import { DownloadDeliveryNotePDF } from "./DownloadDnote";

export function DeliveryNotesTable({ deliveryNotes }) {
  const [selectedNote, setSelectedNote] = useState(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getTotalValue = (items) => {
    return (
      items?.reduce(
        (sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0),
        0
      ) || 0
    );
  };

  const getTotalItems = (items) => {
    return items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
  };

  if (!deliveryNotes || deliveryNotes.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <FileText className="w-16 h-16 text-muted-foreground mb-4" />
          <p className="text-xl font-semibold text-foreground mb-2">
            No delivery notes found
          </p>
          <p className="text-sm text-muted-foreground">
            Try adjusting your search or filters
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Desktop View */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold">DN Number</TableHead>
                  <TableHead className="font-semibold">Date</TableHead>
                  <TableHead className="font-semibold">Customer</TableHead>
                  <TableHead className="font-semibold">Technician</TableHead>
                  <TableHead className="font-semibold">Type</TableHead>
                  <TableHead className="font-semibold">Reason</TableHead>
                  <TableHead className="font-semibold text-right">
                    Items
                  </TableHead>
                  <TableHead className="font-semibold text-right">
                    Total Value
                  </TableHead>
                  <TableHead className="text-right font-semibold">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveryNotes.map((note) => (
                  <TableRow
                    key={note._id}
                    className="hover:bg-muted/50 transition-colors"
                  >
                    <TableCell className="font-mono font-medium text-foreground">
                      {note.deliveryNumber}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(note.date || note.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">
                          {note.customer?.name}
                        </p>
                        {note.customer?.phone && (
                          <p className="text-xs text-muted-foreground">
                            {note.customer.phone}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground">
                      {note.technician?.name || (
                        <span className="text-muted-foreground italic">
                          N/A
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={note.shouldBeReturned ? "outline" : "default"}
                        className={
                          note.shouldBeReturned
                            ? "border-orange-500/50 text-orange-600 bg-orange-500/10"
                            : "bg-green-500/10 text-green-600 border-green-500/20"
                        }
                      >
                        {note.shouldBeReturned ? (
                          <>
                            <TruckIcon className="mr-1 h-3 w-3" />
                            Return
                          </>
                        ) : (
                          <>
                            <PackageCheck className="mr-1 h-3 w-3" />
                            Sale
                          </>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <span className="text-sm text-muted-foreground truncate block">
                        {note.reason || (
                          <span className="italic">No reason provided</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {getTotalItems(note.items)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-foreground">
                      {formatCurrency(getTotalValue(note.items))}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                          >
                            <span className="sr-only">Open menu</span>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="bg-card border-border"
                        >
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedNote(note);
                              setViewDialogOpen(true);
                            }}
                            className="cursor-pointer"
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {/* ✅ PDF DOWNLOAD */}
                          <DownloadDeliveryNotePDF deliveryNote={note} />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Mobile View */}
      <div className="md:hidden space-y-4">
        {deliveryNotes.map((note) => (
          <Card key={note._id} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono font-semibold text-foreground">
                      {note.deliveryNumber}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(note.date || note.createdAt)}
                    </p>
                  </div>
                  <Badge
                    variant={note.shouldBeReturned ? "outline" : "default"}
                    className={
                      note.shouldBeReturned
                        ? "border-orange-500/50 text-orange-600 bg-orange-500/10"
                        : "bg-green-500/10 text-green-600 border-green-500/20"
                    }
                  >
                    {note.shouldBeReturned ? (
                      <>
                        <TruckIcon className="mr-1 h-3 w-3" />
                        Return
                      </>
                    ) : (
                      <>
                        <PackageCheck className="mr-1 h-3 w-3" />
                        Sale
                      </>
                    )}
                  </Badge>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Customer</p>
                    <p className="font-medium text-foreground">
                      {note.customer?.name}
                    </p>
                    {note.customer?.phone && (
                      <p className="text-xs text-muted-foreground">
                        {note.customer.phone}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-muted-foreground">Technician</p>
                    <p className="font-medium text-foreground">
                      {note.technician?.name || (
                        <span className="italic">N/A</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Items</p>
                    <p className="font-medium text-foreground">
                      {getTotalItems(note.items)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Total Value</p>
                    <p className="font-medium text-primary">
                      {formatCurrency(getTotalValue(note.items))}
                    </p>
                  </div>
                </div>

                {/* Reason */}
                {note.reason && (
                  <div className="text-sm">
                    <p className="text-muted-foreground">Reason</p>
                    <p className="font-medium text-foreground">{note.reason}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setSelectedNote(note);
                      setViewDialogOpen(true);
                    }}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    View
                  </Button>

                  {/* ✅ PDF DOWNLOAD BUTTON */}
                  <div className="flex-1">
                    <DownloadDeliveryNotePDF deliveryNote={note} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* View Dialog */}
      {selectedNote && (
        <ViewDeliveryNoteDialog
          deliveryNote={selectedNote}
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
        />
      )}
    </>
  );
}

"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  IconFileText,
  IconPackage,
  IconTruck,
  IconUser,
  IconCalendar,
  IconHash,
} from "@tabler/icons-react";
import { DownloadDeliveryNotePDF } from "./DownloadDnote";

export function ViewDeliveryNoteDialog({ deliveryNote, open, onOpenChange }) {
  if (!deliveryNote) return null;

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getTotalValue = () => {
    return (
      deliveryNote.items?.reduce(
        (sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0),
        0
      ) || 0
    );
  };

  const getTotalItems = () => {
    return (
      deliveryNote.items?.reduce(
        (sum, item) => sum + (item.quantity || 0),
        0
      ) || 0
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconFileText className="h-5 w-5 text-yellow-500" />
            Delivery Note Details
          </DialogTitle>
          <DialogDescription>{deliveryNote.deliveryNumber}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Header Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left Column */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">
                  Delivery Information
                </h3>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <IconHash className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">DN Number</p>
                      <p className="font-semibold">
                        {deliveryNote.deliveryNumber}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <IconCalendar className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Date</p>
                      <p className="font-medium">
                        {formatDate(
                          deliveryNote.date || deliveryNote.createdAt
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <IconPackage className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Type</p>
                      <Badge
                        variant={
                          deliveryNote.shouldBeReturned ? "outline" : "default"
                        }
                        className={
                          deliveryNote.shouldBeReturned
                            ? "border-orange-500/50 text-orange-600"
                            : "bg-green-500/10 text-green-600 border-green-500/20"
                        }
                      >
                        {deliveryNote.shouldBeReturned ? (
                          <>
                            <IconTruck className="mr-1 h-3 w-3" />
                            Returnable
                          </>
                        ) : (
                          <>
                            <IconPackage className="mr-1 h-3 w-3" />
                            Sale
                          </>
                        )}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Right Column */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">
                  People
                </h3>

                <div className="space-y-3">
                  {/* Customer */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Customer
                    </p>
                    <div className="flex items-start gap-2">
                      <IconUser className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="font-semibold">
                          {deliveryNote.customer?.name}
                        </p>
                        {deliveryNote.customer?.phone && (
                          <p className="text-sm text-muted-foreground">
                            {deliveryNote.customer.phone}
                          </p>
                        )}
                        {deliveryNote.customer?.address && (
                          <p className="text-sm text-muted-foreground">
                            {deliveryNote.customer.address}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Technician */}
                  {deliveryNote.technician?.name && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Technician
                      </p>
                      <div className="flex items-start gap-2">
                        <IconUser className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <p className="font-medium">
                          {deliveryNote.technician.name}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Created By */}
                  {deliveryNote.createdBy?.name && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Created By
                      </p>
                      <p className="text-sm font-medium">
                        {deliveryNote.createdBy.name}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Reason */}
          {deliveryNote.reason && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold text-sm text-muted-foreground mb-2">
                  Reason
                </h3>
                <p className="text-sm">{deliveryNote.reason}</p>
              </CardContent>
            </Card>
          )}

          {/* Items */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-4">Items</h3>

              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>SKU/ID</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveryNote.items?.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">
                          {item.name}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.id || "N/A"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {item.type || "Stock"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {item.quantity} {item.unit || "pcs"}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.unitPrice || 0)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(
                            (item.quantity || 0) * (item.unitPrice || 0)
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="space-y-3 md:hidden">
                {deliveryNote.items?.map((item, index) => (
                  <Card key={index}>
                    <CardContent className="p-3">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold">{item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.id || "N/A"}
                            </p>
                          </div>
                          <Badge variant="outline">
                            {item.type || "Stock"}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <p className="text-muted-foreground">Quantity</p>
                            <p className="font-medium">
                              {item.quantity} {item.unit || "pcs"}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Unit Price</p>
                            <p className="font-medium">
                              {formatCurrency(item.unitPrice || 0)}
                            </p>
                          </div>
                        </div>

                        <div className="pt-2 border-t">
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="font-semibold text-primary">
                            {formatCurrency(
                              (item.quantity || 0) * (item.unitPrice || 0)
                            )}
                          </p>
                        </div>

                        {/* Serial Numbers */}
                        {item.serialNo && item.serialNo.length > 0 && (
                          <div className="text-xs">
                            <p className="text-muted-foreground">
                              Serial Numbers:
                            </p>
                            <p className="font-mono">
                              {item.serialNo.join(", ")}
                            </p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Summary */}
              <div className="mt-4 pt-4 border-t space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Items:</span>
                  <span className="font-medium">{getTotalItems()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold">Total Value:</span>
                  <span className="font-bold text-primary text-lg">
                    {formatCurrency(getTotalValue())}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          {deliveryNote.notes && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold text-sm text-muted-foreground mb-2">
                  Notes
                </h3>
                <p className="text-sm whitespace-pre-wrap">
                  {deliveryNote.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {/* ✅ PDF DOWNLOAD */}
            <div className="flex-1">
              <DownloadDeliveryNotePDF deliveryNote={deliveryNote} />
            </div>

            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

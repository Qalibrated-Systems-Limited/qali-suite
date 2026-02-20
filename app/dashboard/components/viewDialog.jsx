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
import { IconClock, IconCheck, IconX, IconBan } from "@tabler/icons-react";
import { RequestDeliveryNotePDFButton } from "./RequestDeliveryNotePDFButton";

const statusConfig = {
  pending: {
    label: "Pending Approval",
    color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    icon: IconClock,
  },
  approved: {
    label: "Approved - Awaiting Fulfillment",
    color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    icon: IconCheck,
  },
  fulfilled: {
    label: "Fulfilled",
    color: "bg-green-500/10 text-green-500 border-green-500/20",
    icon: IconCheck,
  },
  partially_fulfilled: {
    label: "Partially Fulfilled",
    color: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    icon: IconClock,
  },
  rejected: {
    label: "Rejected",
    color: "bg-red-500/10 text-red-500 border-red-500/20",
    icon: IconX,
  },
  cancelled: {
    label: "Cancelled",
    color: "bg-gray-500/10 text-gray-500 border-gray-500/20",
    icon: IconBan,
  },
};

const priorityConfig = {
  low: { label: "Low Priority", color: "bg-gray-500" },
  normal: { label: "Normal Priority", color: "bg-blue-500" },
  high: { label: "High Priority", color: "bg-orange-500" },
  urgent: { label: "Urgent", color: "bg-red-500" },
};

export function ViewRequestDialog({ request, open, onOpenChange, company }) {
  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "long",
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

  const StatusIcon = statusConfig[request.status]?.icon || IconClock;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request Details</DialogTitle>
          <DialogDescription>{request.requestNumber}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Status and Priority */}
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className={`${statusConfig[request.status]?.color} text-sm`}
            >
              <StatusIcon className="mr-2 h-4 w-4" />
              {statusConfig[request.status]?.label}
            </Badge>
            <Badge
              variant="outline"
              className={`${
                priorityConfig[request.priority]?.color
              } text-white text-sm`}
            >
              {priorityConfig[request.priority]?.label}
            </Badge>
          </div>

          {/* Requester Information */}
          <Card>
            <CardContent className="p-4">
              <h4 className="font-semibold mb-3">Requester Information</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Name</p>
                  <p className="font-medium">
                    {request.requester?.name || "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Department</p>
                  <p className="font-medium">
                    {request.requester?.department || "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Email</p>
                  <p className="font-medium">
                    {request.requester?.email || "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Employee ID</p>
                  <p className="font-medium">
                    {request.requester?.id || "N/A"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Request Type */}
          {request.requestType && (
            <Card>
              <CardContent className="p-4">
                <h4 className="font-semibold mb-2">Request Type</h4>
                <p className="text-sm capitalize">
                  {request.requestType.replace(/_/g, " ")}
                </p>
                {request.requestDetails && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {request.requestDetails}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Customer */}
          {request.customer?.id && (
            <Card>
              <CardContent className="p-4">
                <h4 className="font-semibold mb-2">Customer</h4>
                <div className="space-y-1 text-sm">
                  <p className="font-medium">{request.customer.name}</p>
                  {request.customer.email && (
                    <p className="text-muted-foreground">{request.customer.email}</p>
                  )}
                  {request.customer.phone && (
                    <p className="text-muted-foreground">{request.customer.phone}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Items */}
          <div>
            <h4 className="font-semibold mb-3">Requested Items</h4>
            <div className="space-y-2">
              {request.items?.map((item, index) => (
                <Card key={index}>
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 space-y-1">
                        <p className="font-semibold">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          SKU: {item.SKU}
                        </p>
                        {item.notes && (
                          <p className="text-xs text-muted-foreground">
                            Notes: {item.notes}
                          </p>
                        )}
                      </div>
                      <div className="text-right space-y-1">
                        <p className="font-semibold">
                          Requested: {item.requestedQuantity}
                        </p>
                        {item.approvedQuantity !== undefined && (
                          <p className="text-sm text-blue-600">
                            Approved: {item.approvedQuantity}
                          </p>
                        )}
                        {item.fulfilledQuantity !== undefined &&
                          item.fulfilledQuantity > 0 && (
                            <p className="text-sm text-green-600">
                              Fulfilled: {item.fulfilledQuantity}
                            </p>
                          )}
                        {item.unitPrice && (
                          <p className="text-xs text-muted-foreground">
                            @ {formatCurrency(item.unitPrice)}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Notes */}
          {request.notes && (
            <Card>
              <CardContent className="p-4">
                <h4 className="font-semibold mb-2">Request Notes</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {request.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Approval Information */}
          {request.approver && (
            <Card className="bg-blue-50/50 dark:bg-blue-950/20">
              <CardContent className="p-4">
                <h4 className="font-semibold mb-3 text-blue-700 dark:text-blue-400">
                  Approval Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Approved By</p>
                    <p className="font-medium">{request.approver.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Approved At</p>
                    <p className="font-medium">
                      {formatDate(request.approver.approvedAt)}
                    </p>
                  </div>
                  {request.approver.comments && (
                    <div className="md:col-span-2">
                      <p className="text-muted-foreground text-xs">Comments</p>
                      <p className="text-sm">{request.approver.comments}</p>
                    </div>
                  )}
                  {request.approver.conditions && (
                    <div className="md:col-span-2">
                      <p className="text-muted-foreground text-xs">
                        Conditions
                      </p>
                      <p className="text-sm">{request.approver.conditions}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Fulfillment Information */}
          {request.storekeeper && (
            <Card className="bg-green-50/50 dark:bg-green-950/20">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <h4 className="font-semibold text-green-700 dark:text-green-400">
                    Fulfillment Information
                  </h4>
                  <RequestDeliveryNotePDFButton request={request} company={company} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Fulfilled By
                    </p>
                    <p className="font-medium">{request.storekeeper.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Fulfilled At
                    </p>
                    <p className="font-medium">
                      {formatDate(request.storekeeper.fulfilledAt)}
                    </p>
                  </div>
                  {request.storekeeper.comments && (
                    <div className="md:col-span-2">
                      <p className="text-muted-foreground text-xs">Comments</p>
                      <p className="text-sm">{request.storekeeper.comments}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Rejection Information */}
          {request.rejectedBy && (
            <Card className="bg-red-50/50 dark:bg-red-950/20">
              <CardContent className="p-4">
                <h4 className="font-semibold mb-3 text-red-700 dark:text-red-400">
                  Rejection Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Rejected By</p>
                    <p className="font-medium">{request.rejectedBy.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Rejected At</p>
                    <p className="font-medium">
                      {formatDate(request.rejectedAt)}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-muted-foreground text-xs">Reason</p>
                    <p className="text-sm">{request.rejectionReason}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cancellation Information */}
          {request.status === "cancelled" && request.cancellationReason && (
            <Card className="bg-gray-50/50 dark:bg-gray-950/20">
              <CardContent className="p-4">
                <h4 className="font-semibold mb-3">Cancellation Information</h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Cancelled At
                    </p>
                    <p className="font-medium">
                      {formatDate(request.cancelledAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Reason</p>
                    <p>{request.cancellationReason}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary */}
          <Card className="bg-muted/50">
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Created</p>
                  <p className="font-medium">{formatDate(request.createdAt)}</p>
                </div>
                {request.requiredByDate && (
                  <div>
                    <p className="text-muted-foreground text-xs">Required By</p>
                    <p className="font-medium">
                      {formatDate(request.requiredByDate)}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs">Total Items</p>
                  <p className="font-semibold">{request.items?.length || 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Total Value</p>
                  <p className="font-semibold text-primary">
                    {formatCurrency(request.totalValue || 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}

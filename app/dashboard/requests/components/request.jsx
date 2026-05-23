"use client";

import { useState } from "react";
import Link from "next/link";
import {
  IconClipboardList,
  IconEye,
  IconChevronDown,
  IconClock,
  IconCheck,
  IconX,
  IconPackage,
  IconBan,
  IconProgress,
} from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ApproveDialog,
  RejectDialog,
  FulfillDialog,
  CancelDialog,
} from "./../../components/requestsActionsDialogs";

const statusConfig = {
  pending: {
    label: "Pending",
    color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    icon: IconClock,
  },
  approved: {
    label: "Approved",
    color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    icon: IconCheck,
  },
  fulfilled: {
    label: "Fulfilled",
    color: "bg-green-500/10 text-green-500 border-green-500/20",
    icon: IconCheck,
  },
  partially_fulfilled: {
    label: "Partial",
    color: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    icon: IconProgress,
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
  low: { label: "Low", color: "bg-gray-500" },
  normal: { label: "Normal", color: "bg-blue-500" },
  high: { label: "High", color: "bg-orange-500" },
  urgent: { label: "Urgent", color: "bg-red-500" },
};

export function RequestsListWithActions({ requests, userRole, userId }) {
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [fulfillDialogOpen, setFulfillDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const filteredRequests = requests ?? [];

  // Canonical role names. Earlier the checks used lowercase
  // ("manager"/"admin") which never matched against the session's
  // canonical roles — the action buttons silently disappeared.
  const APPROVE_ROLES = ["SuperAdmin", "Admin", "Manager", "Store Manager"];
  const FULFILL_ROLES = ["SuperAdmin", "Admin", "Store Manager"];
  const CANCEL_ROLES = ["SuperAdmin", "Admin", "Manager", "Store Manager"];

  const canApprove = (request) => {
    return (
      APPROVE_ROLES.includes(userRole) &&
      request.status === "pending" &&
      request.requester.id !== userId
    );
  };

  const canFulfill = (request) => {
    return (
      FULFILL_ROLES.includes(userRole) &&
      (request.status === "approved" ||
        request.status === "partially_fulfilled")
    );
  };

  const canCancel = (request) => {
    return (
      (request.requester.id === userId || CANCEL_ROLES.includes(userRole)) &&
      (request.status === "pending" || request.status === "approved")
    );
  };

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

  // ============================================
  // NEW: Calculate fulfillment progress
  // ============================================
  const getFulfillmentProgress = (request) => {
    if (request.status === "pending") return 0;

    const totalRequested = request.items.reduce(
      (sum, item) => sum + (item.approvedQuantity || item.requestedQuantity),
      0
    );
    const totalFulfilled = request.items.reduce(
      (sum, item) => sum + (item.totalFulfilled || 0),
      0
    );

    if (totalRequested === 0) return 0;
    return Math.round((totalFulfilled / totalRequested) * 100);
  };

  const getTotalRemaining = (request) => {
    return request.items.reduce(
      (sum, item) => sum + (item.remainingToFulfill || 0),
      0
    );
  };

  return (
    <TooltipProvider>
      {/* Desktop Table View */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request #</TableHead>
                <TableHead>Requester</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <IconClipboardList className="h-8 w-8" />
                      <p>No requests found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRequests.map((request) => {
                  const StatusIcon =
                    statusConfig[request.status]?.icon || IconClock;
                  const statusStyle = statusConfig[request.status]?.color;
                  const statusLabel = statusConfig[request.status]?.label;
                  const progress = getFulfillmentProgress(request);
                  const remaining = getTotalRemaining(request);

                  return (
                    <TableRow key={request._id}>
                      <TableCell className="font-medium">
                        {request.requestNumber}
                      </TableCell>
                      <TableCell>{request.requester?.name}</TableCell>
                      <TableCell>{request.requester?.department}</TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {request.items?.length || 0} item(s)
                        </span>
                      </TableCell>

                      {/* NEW: Progress Column */}
                      <TableCell>
                        {request.status === "approved" ||
                        request.status === "partially_fulfilled" ||
                        request.status === "fulfilled" ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Progress
                                    value={progress}
                                    className="h-2 w-20"
                                  />
                                  <span className="text-xs text-muted-foreground">
                                    {progress}%
                                  </span>
                                </div>
                                {remaining > 0 && (
                                  <p className="text-xs text-orange-600">
                                    {remaining} remaining
                                  </p>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">
                                Fulfillment Progress: {progress}%
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            N/A
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className={statusStyle}>
                          <StatusIcon className="mr-1 h-3 w-3" />
                          {statusLabel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-2 w-2 rounded-full ${
                              priorityConfig[request.priority]?.color
                            }`}
                          />
                          <span className="text-sm">
                            {priorityConfig[request.priority]?.label}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {formatCurrency(request.totalValue || 0)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(request.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <IconChevronDown className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/dashboard/requests/${request._id}`}
                                className="flex w-full cursor-pointer items-center"
                              >
                                <IconEye className="mr-2 h-4 w-4" />
                                View Details
                              </Link>
                            </DropdownMenuItem>

                            {canApprove(request) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedRequest(request);
                                    setApproveDialogOpen(true);
                                  }}
                                  className="text-green-600"
                                >
                                  <IconCheck className="mr-2 h-4 w-4" />
                                  Approve
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedRequest(request);
                                    setRejectDialogOpen(true);
                                  }}
                                  className="text-red-600"
                                >
                                  <IconX className="mr-2 h-4 w-4" />
                                  Reject
                                </DropdownMenuItem>
                              </>
                            )}

                            {canFulfill(request) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedRequest(request);
                                    setFulfillDialogOpen(true);
                                  }}
                                  className="text-primary"
                                >
                                  <IconPackage className="mr-2 h-4 w-4" />
                                  Fulfill Request
                                  {remaining > 0 && (
                                    <Badge
                                      variant="secondary"
                                      className="ml-2 text-xs"
                                    >
                                      {remaining} left
                                    </Badge>
                                  )}
                                </DropdownMenuItem>
                              </>
                            )}

                            {canCancel(request) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedRequest(request);
                                    setCancelDialogOpen(true);
                                  }}
                                  className="text-destructive"
                                >
                                  <IconBan className="mr-2 h-4 w-4" />
                                  Cancel Request
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Mobile Card View */}
      <div className="space-y-4 md:hidden">
        {filteredRequests.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <IconClipboardList className="h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">No requests found</p>
            </CardContent>
          </Card>
        ) : (
          filteredRequests.map((request) => {
            const StatusIcon = statusConfig[request.status]?.icon || IconClock;
            const statusStyle = statusConfig[request.status]?.color;
            const statusLabel = statusConfig[request.status]?.label;
            const progress = getFulfillmentProgress(request);
            const remaining = getTotalRemaining(request);

            return (
              <Card key={request._id}>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">{request.requestNumber}</p>
                        <p className="text-sm text-muted-foreground">
                          {request.requester?.name}
                        </p>
                      </div>
                      <Badge variant="outline" className={statusStyle}>
                        <StatusIcon className="mr-1 h-3 w-3" />
                        {statusLabel}
                      </Badge>
                    </div>

                    {/* NEW: Progress Bar for partial/fulfilled */}
                    {(request.status === "approved" ||
                      request.status === "partially_fulfilled" ||
                      request.status === "fulfilled") && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Fulfillment Progress</span>
                          <span>{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-2" />
                        {remaining > 0 && (
                          <p className="text-xs text-orange-600">
                            {remaining} items remaining
                          </p>
                        )}
                      </div>
                    )}

                    {/* Details */}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Department</p>
                        <p className="font-medium">
                          {request.requester?.department}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Items</p>
                        <p className="font-medium">{request.items?.length}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Priority</p>
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-2 w-2 rounded-full ${
                              priorityConfig[request.priority]?.color
                            }`}
                          />
                          <span className="font-medium">
                            {priorityConfig[request.priority]?.label}
                          </span>
                        </div>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Value</p>
                        <p className="font-medium">
                          {formatCurrency(request.totalValue || 0)}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        asChild
                      >
                        <Link href={`/dashboard/requests/${request._id}`}>
                          <IconEye className="mr-2 h-4 w-4" />
                          View
                        </Link>
                      </Button>

                      {canApprove(request) && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedRequest(request);
                              setApproveDialogOpen(true);
                            }}
                            className="text-green-600"
                          >
                            <IconCheck className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedRequest(request);
                              setRejectDialogOpen(true);
                            }}
                            className="text-red-600"
                          >
                            <IconX className="h-4 w-4" />
                          </Button>
                        </>
                      )}

                      {canFulfill(request) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-primary"
                          onClick={() => {
                            setSelectedRequest(request);
                            setFulfillDialogOpen(true);
                          }}
                        >
                          <IconPackage className="mr-2 h-4 w-4" />
                          Fulfill
                          {remaining > 0 && (
                            <Badge variant="secondary" className="ml-1 text-xs">
                              {remaining}
                            </Badge>
                          )}
                        </Button>
                      )}

                      {canCancel(request) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedRequest(request);
                            setCancelDialogOpen(true);
                          }}
                          className="text-destructive"
                        >
                          <IconBan className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Action dialogs — View was promoted to a full page at
          /dashboard/requests/[id]; approve/reject/fulfill/cancel remain
          inline so users can act without leaving the list. */}
      {selectedRequest && (
        <>
          <ApproveDialog
            request={selectedRequest}
            open={approveDialogOpen}
            onOpenChange={setApproveDialogOpen}
          />

          <RejectDialog
            request={selectedRequest}
            open={rejectDialogOpen}
            onOpenChange={setRejectDialogOpen}
          />

          <FulfillDialog
            request={selectedRequest}
            open={fulfillDialogOpen}
            onOpenChange={setFulfillDialogOpen}
          />

          <CancelDialog
            request={selectedRequest}
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
          />
        </>
      )}
    </TooltipProvider>
  );
}

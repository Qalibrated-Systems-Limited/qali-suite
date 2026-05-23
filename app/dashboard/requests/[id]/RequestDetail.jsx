"use client";

import { useState } from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconClock,
  IconCheck,
  IconX,
  IconBan,
  IconPackage,
} from "@tabler/icons-react";
import { CheckCircle2, XCircle, Truck, Ban } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import {
  ApproveDialog,
  RejectDialog,
  FulfillDialog,
  CancelDialog,
} from "@/app/dashboard/components/requestsActionsDialogs";
import { RequestDeliveryNotePDFButton } from "@/app/dashboard/components/RequestDeliveryNotePDFButton";

// ============================================
// CONSTANTS
// ============================================
const statusConfig = {
  pending: {
    label: "Pending Approval",
    color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    icon: IconClock,
  },
  approved: {
    label: "Approved — Awaiting Fulfillment",
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
  invoiced: {
    label: "Invoiced",
    color: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    icon: IconCheck,
  },
};

const priorityConfig = {
  low: { label: "Low Priority", color: "bg-gray-500" },
  normal: { label: "Normal Priority", color: "bg-blue-500" },
  high: { label: "High Priority", color: "bg-orange-500" },
  urgent: { label: "Urgent", color: "bg-red-500" },
};

// Canonical role allowlists — mirror the list component so the action
// visibility logic stays consistent everywhere.
const APPROVE_ROLES = ["SuperAdmin", "Admin", "Manager", "Store Manager"];
const FULFILL_ROLES = ["SuperAdmin", "Admin", "Store Manager"];
const CANCEL_ROLES = ["SuperAdmin", "Admin", "Manager", "Store Manager"];

// ============================================
// HELPERS
// ============================================
function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
  }).format(amount || 0);
}

// ============================================
// COMPONENT
// ============================================
export function RequestDetail({ request, userRole, userId, company }) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const StatusIcon = statusConfig[request.status]?.icon || IconClock;

  const canApprove =
    APPROVE_ROLES.includes(userRole) &&
    request.status === "pending" &&
    request.requester?.id !== userId;

  const canFulfill =
    FULFILL_ROLES.includes(userRole) &&
    (request.status === "approved" ||
      request.status === "partially_fulfilled");

  const canCancel =
    (request.requester?.id === userId || CANCEL_ROLES.includes(userRole)) &&
    (request.status === "pending" || request.status === "approved");

  const hasAnyAction = canApprove || canFulfill || canCancel;

  return (
    <div className="flex flex-col gap-4 p-3 sm:gap-6 sm:p-6">
      {/* Header — stacks on mobile, splits on sm+ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href="/dashboard/requests" aria-label="Back to requests">
              <IconArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold tracking-tight sm:text-2xl">
              Stock Request
            </h1>
            <p className="break-all font-mono text-xs text-muted-foreground sm:text-sm">
              {request.requestNumber}
            </p>
          </div>
        </div>

        {/* Action buttons — stacked vertically on mobile, inline on sm+ */}
        {hasAnyAction && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {canApprove && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => setApproveOpen(true)}
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                Approve
              </Button>
            )}
            {canApprove && (
              <Button
                size="sm"
                variant="outline"
                className="border-red-500/30 text-red-600 hover:bg-red-500/10"
                onClick={() => setRejectOpen(true)}
              >
                <XCircle className="mr-1.5 h-4 w-4" />
                Reject
              </Button>
            )}
            {canFulfill && (
              <Button
                size="sm"
                onClick={() => setFulfillOpen(true)}
              >
                <Truck className="mr-1.5 h-4 w-4" />
                Fulfill
              </Button>
            )}
            {canCancel && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setCancelOpen(true)}
              >
                <Ban className="mr-1.5 h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Status + priority strip */}
      <div className="flex flex-wrap gap-2">
        <Badge
          variant="outline"
          className={`${statusConfig[request.status]?.color} text-xs sm:text-sm`}
        >
          <StatusIcon className="mr-1.5 h-3.5 w-3.5" />
          {statusConfig[request.status]?.label || request.status}
        </Badge>
        <Badge
          variant="outline"
          className={`${priorityConfig[request.priority]?.color} text-white text-xs sm:text-sm`}
        >
          {priorityConfig[request.priority]?.label || request.priority}
        </Badge>
        {request.requestType && (
          <Badge variant="outline" className="text-xs sm:text-sm capitalize">
            {request.requestType.replace(/_/g, " ")}
          </Badge>
        )}
      </div>

      {/* Summary tile strip — 2 cols on mobile, 4 on lg */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Created" value={formatDate(request.createdAt)} />
        {request.requiredByDate && (
          <SummaryTile
            label="Required by"
            value={formatDate(request.requiredByDate)}
          />
        )}
        <SummaryTile
          label="Items"
          value={String(request.items?.length || 0)}
        />
        <SummaryTile
          label="Total value"
          value={formatCurrency(request.totalValue)}
          accent
        />
      </div>

      {/* Two-column grid on lg+, stacked on mobile */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* LEFT — primary detail */}
        <div className="space-y-4 lg:col-span-2">
          {/* Items */}
          <Card className="bg-card border-border">
            <CardContent className="p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <IconPackage className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold">Requested items</h2>
              </div>
              <div className="space-y-2">
                {(request.items || []).map((item, index) => (
                  <div
                    key={item._id || index}
                    className="rounded-md border border-border bg-muted/30 p-3"
                  >
                    {/* Item row: stack on mobile, side-by-side on sm+ */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="break-words font-semibold text-sm sm:text-base">
                          {item.productName}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                          SKU: {item.SKU}
                        </p>
                        {item.notes && (
                          <p className="text-xs text-muted-foreground">
                            {item.notes}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5 text-sm sm:items-end sm:text-right">
                        <span className="font-semibold">
                          Req: {item.requestedQuantity}
                        </span>
                        {item.approvedQuantity > 0 && (
                          <span className="text-blue-600 dark:text-blue-400">
                            Approved: {item.approvedQuantity}
                          </span>
                        )}
                        {item.totalFulfilled > 0 && (
                          <span className="text-green-600 dark:text-green-400">
                            Fulfilled: {item.totalFulfilled}
                          </span>
                        )}
                        {item.unitPrice > 0 && (
                          <span className="text-xs text-muted-foreground">
                            @ {formatCurrency(item.unitPrice)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          {request.notes && (
            <Card className="bg-card border-border">
              <CardContent className="p-4 sm:p-5">
                <h2 className="mb-2 font-semibold">Request notes</h2>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {request.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Approval info */}
          {request.approver?.id && (
            <Card className="bg-blue-50/50 dark:bg-blue-950/20">
              <CardContent className="p-4 sm:p-5">
                <h2 className="mb-3 font-semibold text-blue-700 dark:text-blue-400">
                  Approval
                </h2>
                <DefList
                  rows={[
                    ["Approved by", request.approver.name || "—"],
                    ["Approved at", formatDate(request.approver.approvedAt)],
                    request.approver.comments && [
                      "Comments",
                      request.approver.comments,
                    ],
                    request.approver.conditions && [
                      "Conditions",
                      request.approver.conditions,
                    ],
                  ].filter(Boolean)}
                />
              </CardContent>
            </Card>
          )}

          {/* Fulfillment info */}
          {request.storekeeper?.id && (
            <Card className="bg-green-50/50 dark:bg-green-950/20">
              <CardContent className="p-4 sm:p-5">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-green-700 dark:text-green-400">
                    Fulfillment
                  </h2>
                  <RequestDeliveryNotePDFButton
                    request={request}
                    company={company}
                  />
                </div>
                <DefList
                  rows={[
                    ["Fulfilled by", request.storekeeper.name || "—"],
                    [
                      "Fulfilled at",
                      formatDate(request.storekeeper.fulfilledAt),
                    ],
                    request.storekeeper.comments && [
                      "Comments",
                      request.storekeeper.comments,
                    ],
                  ].filter(Boolean)}
                />
              </CardContent>
            </Card>
          )}

          {/* Rejection info */}
          {request.rejectedBy?.id && (
            <Card className="bg-red-50/50 dark:bg-red-950/20">
              <CardContent className="p-4 sm:p-5">
                <h2 className="mb-3 font-semibold text-red-700 dark:text-red-400">
                  Rejection
                </h2>
                <DefList
                  rows={[
                    ["Rejected by", request.rejectedBy.name || "—"],
                    ["Rejected at", formatDate(request.rejectedAt)],
                    request.rejectionReason && [
                      "Reason",
                      request.rejectionReason,
                    ],
                  ].filter(Boolean)}
                />
              </CardContent>
            </Card>
          )}

          {/* Cancellation info */}
          {request.status === "cancelled" && (
            <Card className="bg-muted/40">
              <CardContent className="p-4 sm:p-5">
                <h2 className="mb-3 font-semibold">Cancellation</h2>
                <DefList
                  rows={[
                    ["Cancelled at", formatDate(request.cancelledAt)],
                    request.cancellationReason && [
                      "Reason",
                      request.cancellationReason,
                    ],
                  ].filter(Boolean)}
                />
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT — meta sidebar (on lg+); inline on mobile */}
        <div className="space-y-4">
          {/* Requester */}
          <Card className="bg-card border-border">
            <CardContent className="p-4 sm:p-5">
              <h2 className="mb-3 font-semibold">Requester</h2>
              <DefList
                rows={[
                  ["Name", request.requester?.name || "—"],
                  ["Department", request.requester?.department || "—"],
                  request.requester?.email && [
                    "Email",
                    request.requester.email,
                  ],
                  request.requester?.phone && [
                    "Phone",
                    request.requester.phone,
                  ],
                ].filter(Boolean)}
              />
            </CardContent>
          </Card>

          {/* Customer (if any) */}
          {request.customer?.id && (
            <Card className="bg-card border-border">
              <CardContent className="p-4 sm:p-5">
                <h2 className="mb-3 font-semibold">Customer</h2>
                <DefList
                  rows={[
                    ["Name", request.customer.name || "—"],
                    request.customer.email && ["Email", request.customer.email],
                    request.customer.phone && ["Phone", request.customer.phone],
                    request.customer.address && [
                      "Address",
                      request.customer.address,
                    ],
                  ].filter(Boolean)}
                />
              </CardContent>
            </Card>
          )}

          {/* Project (if linked) */}
          {request.project?.projectNumber && (
            <Card className="bg-card border-border">
              <CardContent className="p-4 sm:p-5">
                <h2 className="mb-3 font-semibold">Project</h2>
                <DefList
                  rows={[
                    ["Project", request.project.name || "—"],
                    ["Number", request.project.projectNumber],
                    request.costCode?.code && [
                      "Cost code",
                      `${request.costCode.code} — ${request.costCode.name || ""}`,
                    ],
                  ].filter(Boolean)}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Action dialogs — same components the list uses */}
      <ApproveDialog
        request={request}
        open={approveOpen}
        onOpenChange={setApproveOpen}
      />
      <RejectDialog
        request={request}
        open={rejectOpen}
        onOpenChange={setRejectOpen}
      />
      <FulfillDialog
        request={request}
        open={fulfillOpen}
        onOpenChange={setFulfillOpen}
      />
      <CancelDialog
        request={request}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
      />
    </div>
  );
}

// ============================================
// SMALL PRESENTATIONAL HELPERS
// ============================================
function SummaryTile({ label, value, accent }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-sm font-semibold sm:text-base ${
          accent ? "text-primary" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function DefList({ rows }) {
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      {rows.map(([label, value], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="break-words font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

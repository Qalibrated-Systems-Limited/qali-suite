"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Package, User, Calendar, FileText, AlertCircle } from "lucide-react";

export function ViewCheckoutDialog({ checkout, open, onOpenChange }) {
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

  const statusColors = {
    checked_out: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    returned: "bg-green-500/10 text-green-500 border-green-500/20",
    overdue: "bg-red-500/10 text-red-500 border-red-500/20",
    lost: "bg-gray-500/10 text-gray-500 border-gray-500/20",
    damaged: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background border-border text-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-yellow-500" />
            Checkout Details
          </DialogTitle>
          <DialogDescription>
            {checkout.checkoutNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Status Badge */}
          <div className="flex items-center justify-between">
            <Badge variant="outline" className={statusColors[checkout.status]}>
              {checkout.status.replace(/_/g, " ").toUpperCase()}
            </Badge>
            {checkout.isOverdue && checkout.status === "checked_out" && (
              <Badge
                variant="outline"
                className="bg-red-500/10 text-red-500 border-red-500/20"
              >
                {checkout.daysOverdue} days overdue
              </Badge>
            )}
          </div>

          {/* Product Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Package className="w-4 h-4" />
              Product Information
            </h3>
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg border border-border">
              <div>
                <p className="text-xs text-muted-foreground">Product Name</p>
                <p className="text-sm font-medium text-foreground">
                  {checkout.productSnapshot.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">SKU</p>
                <p className="text-sm font-mono text-foreground">
                  {checkout.productSnapshot.SKU}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Quantity</p>
                <p className="text-sm text-foreground">{checkout.quantity}</p>
              </div>
              {checkout.serialNo && (
                <div>
                  <p className="text-xs text-muted-foreground">Serial Number</p>
                  <p className="text-sm font-mono text-foreground">
                    {checkout.serialNo}
                  </p>
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Checked Out To */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <User className="w-4 h-4" />
              Checked Out To
            </h3>
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg border border-border">
              <div>
                <p className="text-xs text-muted-foreground">Name</p>
                <p className="text-sm font-medium text-foreground">
                  {checkout.checkedOutTo.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Department</p>
                <p className="text-sm text-foreground">
                  {checkout.checkedOutTo.department}
                </p>
              </div>
              {checkout.checkedOutTo.email && (
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="text-sm text-foreground">
                    {checkout.checkedOutTo.email}
                  </p>
                </div>
              )}
              {checkout.checkedOutTo.phone && (
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <p className="text-sm text-foreground">
                    {checkout.checkedOutTo.phone}
                  </p>
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Dates */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Timeline
            </h3>
            <div className="space-y-2 p-4 bg-muted/50 rounded-lg border border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Checkout Date:</span>
                <span className="text-foreground">
                  {formatDate(checkout.checkoutDate)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Expected Return:</span>
                <span className="text-foreground">
                  {formatDate(checkout.expectedReturnDate)}
                </span>
              </div>
              {checkout.returnedDate && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Actual Return:</span>
                  <span className="text-foreground">
                    {formatDate(checkout.returnedDate)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Checked Out By:</span>
                <span className="text-foreground">
                  {checkout.checkedOutBy.name}
                </span>
              </div>
              {checkout.returnedBy && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Returned By:</span>
                  <span className="text-foreground">
                    {checkout.returnedBy.name}
                  </span>
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Purpose & Notes */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Details
            </h3>
            <div className="space-y-2 p-4 bg-muted/50 rounded-lg border border-border">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Purpose</p>
                <p className="text-sm text-foreground">
                  {checkout.purpose.replace(/_/g, " ")}
                </p>
              </div>
              {checkout.purposeDetails && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Purpose Details</p>
                  <p className="text-sm text-foreground">
                    {checkout.purposeDetails}
                  </p>
                </div>
              )}
              {checkout.checkoutNotes && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Checkout Notes</p>
                  <p className="text-sm text-foreground">
                    {checkout.checkoutNotes}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Return Info (if returned) */}
          {checkout.status === "returned" && checkout.returnCondition && (
            <>
              <Separator className="bg-border" />
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Return Information
                </h3>
                <div className="space-y-2 p-4 bg-muted/50 rounded-lg border border-border">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Return Condition
                    </p>
                    <Badge
                      variant="outline"
                      className="bg-green-500/10 text-green-500 border-green-500/20"
                    >
                      {checkout.returnCondition}
                    </Badge>
                  </div>
                  {checkout.returnNotes && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Return Notes</p>
                      <p className="text-sm text-foreground">
                        {checkout.returnNotes}
                      </p>
                    </div>
                  )}
                  {checkout.damageDetails && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Damage Details
                      </p>
                      <p className="text-sm text-orange-400">
                        {checkout.damageDetails}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Escalation Info */}
          {checkout.isEscalated && checkout.escalatedTo && (
            <>
              <Separator className="bg-border" />
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-red-500 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Escalated
                </h3>
                <div className="space-y-2 p-4 bg-red-500/5 rounded-lg border border-red-500/20">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Escalated To:</span>
                    <span className="text-foreground">
                      {checkout.escalatedTo.name}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Escalated At:</span>
                    <span className="text-foreground">
                      {formatDate(checkout.escalatedTo.escalatedAt)}
                    </span>
                  </div>
                  {checkout.escalatedTo.reason && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Reason</p>
                      <p className="text-sm text-foreground">
                        {checkout.escalatedTo.reason}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

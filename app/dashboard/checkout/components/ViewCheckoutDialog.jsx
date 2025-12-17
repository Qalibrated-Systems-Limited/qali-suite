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
      <DialogContent className="bg-[#161b22] border-[#30363d] text-gray-100 max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-yellow-500" />
            Checkout Details
          </DialogTitle>
          <DialogDescription className="text-gray-400">
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
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Package className="w-4 h-4" />
              Product Information
            </h3>
            <div className="grid grid-cols-2 gap-4 p-4 bg-[#0d1117] rounded-lg border border-[#30363d]">
              <div>
                <p className="text-xs text-gray-400">Product Name</p>
                <p className="text-sm font-medium text-white">
                  {checkout.productSnapshot.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">SKU</p>
                <p className="text-sm font-mono text-gray-100">
                  {checkout.productSnapshot.SKU}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Quantity</p>
                <p className="text-sm text-gray-100">{checkout.quantity}</p>
              </div>
              {checkout.serialNo && (
                <div>
                  <p className="text-xs text-gray-400">Serial Number</p>
                  <p className="text-sm font-mono text-gray-100">
                    {checkout.serialNo}
                  </p>
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-[#30363d]" />

          {/* Checked Out To */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <User className="w-4 h-4" />
              Checked Out To
            </h3>
            <div className="grid grid-cols-2 gap-4 p-4 bg-[#0d1117] rounded-lg border border-[#30363d]">
              <div>
                <p className="text-xs text-gray-400">Name</p>
                <p className="text-sm font-medium text-white">
                  {checkout.checkedOutTo.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Department</p>
                <p className="text-sm text-gray-100">
                  {checkout.checkedOutTo.department}
                </p>
              </div>
              {checkout.checkedOutTo.email && (
                <div>
                  <p className="text-xs text-gray-400">Email</p>
                  <p className="text-sm text-gray-100">
                    {checkout.checkedOutTo.email}
                  </p>
                </div>
              )}
              {checkout.checkedOutTo.phone && (
                <div>
                  <p className="text-xs text-gray-400">Phone</p>
                  <p className="text-sm text-gray-100">
                    {checkout.checkedOutTo.phone}
                  </p>
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-[#30363d]" />

          {/* Dates */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Timeline
            </h3>
            <div className="space-y-2 p-4 bg-[#0d1117] rounded-lg border border-[#30363d]">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Checkout Date:</span>
                <span className="text-gray-100">
                  {formatDate(checkout.checkoutDate)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Expected Return:</span>
                <span className="text-gray-100">
                  {formatDate(checkout.expectedReturnDate)}
                </span>
              </div>
              {checkout.returnedDate && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Actual Return:</span>
                  <span className="text-gray-100">
                    {formatDate(checkout.returnedDate)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Checked Out By:</span>
                <span className="text-gray-100">
                  {checkout.checkedOutBy.name}
                </span>
              </div>
              {checkout.returnedBy && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Returned By:</span>
                  <span className="text-gray-100">
                    {checkout.returnedBy.name}
                  </span>
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-[#30363d]" />

          {/* Purpose & Notes */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Details
            </h3>
            <div className="space-y-2 p-4 bg-[#0d1117] rounded-lg border border-[#30363d]">
              <div>
                <p className="text-xs text-gray-400 mb-1">Purpose</p>
                <p className="text-sm text-gray-100">
                  {checkout.purpose.replace(/_/g, " ")}
                </p>
              </div>
              {checkout.purposeDetails && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Purpose Details</p>
                  <p className="text-sm text-gray-100">
                    {checkout.purposeDetails}
                  </p>
                </div>
              )}
              {checkout.checkoutNotes && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Checkout Notes</p>
                  <p className="text-sm text-gray-100">
                    {checkout.checkoutNotes}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Return Info (if returned) */}
          {checkout.status === "returned" && checkout.returnCondition && (
            <>
              <Separator className="bg-[#30363d]" />
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300">
                  Return Information
                </h3>
                <div className="space-y-2 p-4 bg-[#0d1117] rounded-lg border border-[#30363d]">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">
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
                      <p className="text-xs text-gray-400 mb-1">Return Notes</p>
                      <p className="text-sm text-gray-100">
                        {checkout.returnNotes}
                      </p>
                    </div>
                  )}
                  {checkout.damageDetails && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">
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
              <Separator className="bg-[#30363d]" />
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-red-500 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Escalated
                </h3>
                <div className="space-y-2 p-4 bg-red-500/5 rounded-lg border border-red-500/20">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Escalated To:</span>
                    <span className="text-gray-100">
                      {checkout.escalatedTo.name}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Escalated At:</span>
                    <span className="text-gray-100">
                      {formatDate(checkout.escalatedTo.escalatedAt)}
                    </span>
                  </div>
                  {checkout.escalatedTo.reason && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Reason</p>
                      <p className="text-sm text-gray-100">
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

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
import {
  Package,
  User,
  Calendar,
  FileText,
  ArrowDownCircle,
  ArrowUpCircle,
  DollarSign,
} from "lucide-react";

const typeConfig = {
  issue: {
    label: "Issue",
    color: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  return: {
    label: "Return",
    color: "bg-green-500/10 text-green-500 border-green-500/20",
  },
  sale: {
    label: "Sale",
    color: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  },
  purchase: {
    label: "Purchase",
    color: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  },
  adjustment: {
    label: "Adjustment",
    color: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  },
  damage: {
    label: "Damage",
    color: "bg-red-500/10 text-red-500 border-red-500/20",
  },
  transfer: {
    label: "Transfer",
    color: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  },
  initial: {
    label: "Initial",
    color: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  },
};

export function ViewMovementDialog({ movement, open, onOpenChange }) {
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
    // Handle undefined, null, or NaN values
    const safeAmount = typeof amount === "number" && !isNaN(amount) ? amount : 0;
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(safeAmount);
  };

  // Get movement value from costing fields (schema-defined)
  const getMovementValue = () => {
    return movement.costing?.totalValue || movement.costing?.totalCost || 0;
  };

  const typeStyle = typeConfig[movement.movementType]?.color;
  const typeLabel = typeConfig[movement.movementType]?.label;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-gray-100 max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-yellow-500" />
            Movement Details
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            {movement.movementNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Type & Direction Badges */}
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={typeStyle}>
              {typeLabel}
            </Badge>
            <Badge
              variant="outline"
              className={
                movement.direction === "in"
                  ? "bg-green-500/10 text-green-500 border-green-500/20"
                  : "bg-red-500/10 text-red-500 border-red-500/20"
              }
            >
              {movement.direction === "in" ? (
                <ArrowDownCircle className="mr-1 h-3 w-3" />
              ) : (
                <ArrowUpCircle className="mr-1 h-3 w-3" />
              )}
              Stock {movement.direction === "in" ? "In" : "Out"}
            </Badge>
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
                  {movement.productSnapshot.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">SKU</p>
                <p className="text-sm font-mono text-gray-100">
                  {movement.productSnapshot.SKU}
                </p>
              </div>
              {movement.productSnapshot.category && (
                <div>
                  <p className="text-xs text-gray-400">Category</p>
                  <p className="text-sm text-gray-100">
                    {movement.productSnapshot.category}
                  </p>
                </div>
              )}
              {movement.serialNo && (
                <div>
                  <p className="text-xs text-gray-400">Serial Number</p>
                  <p className="text-sm font-mono text-gray-100">
                    {movement.serialNo}
                  </p>
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-[#30363d]" />

          {/* Quantity & Value */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Quantity & Value
            </h3>
            <div className="grid grid-cols-2 gap-4 p-4 bg-[#0d1117] rounded-lg border border-[#30363d]">
              <div>
                <p className="text-xs text-gray-400">Quantity</p>
                <p className="text-2xl font-bold text-white">
                  {movement.quantity}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Unit Price</p>
                <p className="text-lg font-semibold text-gray-100">
                  {formatCurrency(movement.unitPrice || 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Previous Stock</p>
                <p className="text-lg font-semibold text-gray-100">
                  {movement.previousStock}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">New Stock</p>
                <p className="text-lg font-semibold text-gray-100">
                  {movement.newStock}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-gray-400">Total Value</p>
                <p className="text-2xl font-bold text-yellow-500">
                  {formatCurrency(getMovementValue())}
                </p>
              </div>
            </div>
          </div>

          <Separator className="bg-[#30363d]" />

          {/* Performed By */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <User className="w-4 h-4" />
              Performed By
            </h3>
            <div className="grid grid-cols-2 gap-4 p-4 bg-[#0d1117] rounded-lg border border-[#30363d]">
              <div>
                <p className="text-xs text-gray-400">Name</p>
                <p className="text-sm font-medium text-white">
                  {movement.performedBy.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Role</p>
                <p className="text-sm text-gray-100">
                  {movement.performedBy.role}
                </p>
              </div>
            </div>
          </div>

          {/* Issued To (if applicable) */}
          {movement.issuedTo && movement.issuedTo.name && (
            <>
              <Separator className="bg-[#30363d]" />
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Issued To
                </h3>
                <div className="grid grid-cols-2 gap-4 p-4 bg-[#0d1117] rounded-lg border border-[#30363d]">
                  <div>
                    <p className="text-xs text-gray-400">Name</p>
                    <p className="text-sm font-medium text-white">
                      {movement.issuedTo.name}
                    </p>
                  </div>
                  {movement.issuedTo.department && (
                    <div>
                      <p className="text-xs text-gray-400">Department</p>
                      <p className="text-sm text-gray-100">
                        {movement.issuedTo.department}
                      </p>
                    </div>
                  )}
                  {movement.issuedTo.purpose && (
                    <div className="col-span-2">
                      <p className="text-xs text-gray-400">Purpose</p>
                      <p className="text-sm text-gray-100">
                        {movement.issuedTo.purpose}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Returned By (if applicable) */}
          {movement.returnedBy && movement.returnedBy.name && (
            <>
              <Separator className="bg-[#30363d]" />
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Returned By
                </h3>
                <div className="grid grid-cols-2 gap-4 p-4 bg-[#0d1117] rounded-lg border border-[#30363d]">
                  <div>
                    <p className="text-xs text-gray-400">Name</p>
                    <p className="text-sm font-medium text-white">
                      {movement.returnedBy.name}
                    </p>
                  </div>
                  {movement.returnedBy.condition && (
                    <div>
                      <p className="text-xs text-gray-400">Condition</p>
                      <Badge variant="outline" className="capitalize">
                        {movement.returnedBy.condition}
                      </Badge>
                    </div>
                  )}
                  {movement.returnedBy.conditionNotes && (
                    <div className="col-span-2">
                      <p className="text-xs text-gray-400">Notes</p>
                      <p className="text-sm text-gray-100">
                        {movement.returnedBy.conditionNotes}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          <Separator className="bg-[#30363d]" />

          {/* Dates & Details */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Timeline & Details
            </h3>
            <div className="space-y-2 p-4 bg-[#0d1117] rounded-lg border border-[#30363d]">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Movement Date:</span>
                <span className="text-gray-100">
                  {formatDate(movement.createdAt)}
                </span>
              </div>
              {movement.requiresReturn && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Requires Return:</span>
                    <Badge
                      variant="outline"
                      className="bg-orange-500/10 text-orange-500 border-orange-500/20"
                    >
                      Yes
                    </Badge>
                  </div>
                  {movement.expectedReturnDate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Expected Return:</span>
                      <span className="text-gray-100">
                        {formatDate(movement.expectedReturnDate)}
                      </span>
                    </div>
                  )}
                  {movement.actualReturnDate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Actual Return:</span>
                      <span className="text-gray-100">
                        {formatDate(movement.actualReturnDate)}
                      </span>
                    </div>
                  )}
                </>
              )}
              {movement.fromLocation && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">From Location:</span>
                  <span className="text-gray-100">{movement.fromLocation}</span>
                </div>
              )}
              {movement.toLocation && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">To Location:</span>
                  <span className="text-gray-100">{movement.toLocation}</span>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          {(movement.notes || movement.reason) && (
            <>
              <Separator className="bg-[#30363d]" />
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Notes & Reason
                </h3>
                <div className="space-y-2 p-4 bg-[#0d1117] rounded-lg border border-[#30363d]">
                  {movement.reason && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Reason</p>
                      <p className="text-sm text-gray-100">{movement.reason}</p>
                    </div>
                  )}
                  {movement.notes && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Notes</p>
                      <p className="text-sm text-gray-100">{movement.notes}</p>
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

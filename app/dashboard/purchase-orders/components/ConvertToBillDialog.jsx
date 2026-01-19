"use client";

import { useState, useActionState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Receipt, Loader2, AlertCircle, Package, Calendar } from "lucide-react";
import { convertPOToBill } from "@/app/mongodb/actions/purchase-order-actions";
import { formatCurrency } from "@/lib/utils";

const initialState = {
  success: false,
  error: null,
  fieldErrors: null,
};

export function ConvertToBillDialog({ purchaseOrder, open, onOpenChange }) {
  const po = purchaseOrder;

  // Available lines = ordered but not yet received
  const availableLines = po.lines.filter((line) => {
    const receivedQty = line.receivedQuantity || 0;
    return line.quantity > receivedQty;
  });

  // Server action bound with PO ID
  const boundAction = convertPOToBill.bind(null, po._id);
  const [state, formAction, isPending] = useActionState(
    boundAction,
    initialState
  );

  
  // Default dates
  const today = new Date().toISOString().split("T")[0];
  const defaultDueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  // No items available
  if (availableLines.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Bill from PO</DialogTitle>
            <DialogDescription>
              Convert PO items to a supplier bill
            </DialogDescription>
          </DialogHeader>
          <div className="py-8 text-center">
            <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              No items available to bill. All items on this PO have already been
              received and billed.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-purple-500" />
            Create Bill from {po.poNumber}
          </DialogTitle>
          <DialogDescription>
            Select the items and quantities to include in the bill
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-6">
          {/* Error Display */}
          {state.error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{state.error}</p>
            </div>
          )}

          {/* Bill Details */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="billDate">
                <Calendar className="h-4 w-4 inline mr-1.5" />
                Bill Date
              </Label>
              <Input
                id="billDate"
                name="billDate"
                type="date"
                defaultValue={today}
                required
              />
              {state.fieldErrors?.billDate && (
                <p className="text-xs text-destructive">
                  {state.fieldErrors.billDate}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="dueDate">
                <Calendar className="h-4 w-4 inline mr-1.5" />
                Due Date
              </Label>
              <Input
                id="dueDate"
                name="dueDate"
                type="date"
                defaultValue={defaultDueDate}
                required
              />
              {state.fieldErrors?.dueDate && (
                <p className="text-xs text-destructive">
                  {state.fieldErrors.dueDate}
                </p>
              )}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="supplierInvoiceNumber">Supplier Invoice #</Label>
              <Input
                id="supplierInvoiceNumber"
                name="supplierInvoiceNumber"
                placeholder="Enter supplier's invoice number..."
              />
            </div>
          </div>

          <Separator />

          {/* Line Items Selection */}
          <div className="space-y-4">
            <Label>Select Items to Bill</Label>
            <div className="space-y-3">
              {availableLines.map((line, index) => {
                const lineId = line._id?.toString();
                const availableQty =
                  line.quantity - (line.receivedQuantity || 0);

                return (
                  <LineItem
                    key={lineId}
                    line={line}
                    lineId={lineId}
                    index={index}
                    availableQty={availableQty}
                    formatCurrency={formatCurrency}
                  />
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Summary Note */}
          <p className="text-sm text-muted-foreground">
            Totals will be calculated on the server based on selected
            quantities.
          </p>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Bill...
                </>
              ) : (
                <>
                  <Receipt className="mr-2 h-4 w-4" />
                  Create Bill
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Separate component for line item to manage its own checkbox state
function LineItem({ line, lineId, index, availableQty, formatCurrency }) {
  // Only need state for the checkbox to show/hide quantity input
  const [selected, setSelected] = useState(true);

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        selected
          ? "bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800"
          : "bg-muted/30"
      }`}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          id={`line-${lineId}`}
          checked={selected}
          onCheckedChange={setSelected}
          className="mt-1"
        />
        <div className="flex-1 min-w-0">
          <label htmlFor={`line-${lineId}`} className="block cursor-pointer">
            <p className="font-medium">{line.description}</p>
            {line.product?.name && (
              <p className="text-xs text-muted-foreground">
                {line.product.sku && (
                  <span className="font-mono">{line.product.sku} - </span>
                )}
                {line.product.name}
              </p>
            )}
          </label>
          <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
            <span>
              Ordered: {line.quantity} {line.unit}
            </span>
            <span>
              Received: {line.receivedQuantity || 0} {line.unit}
            </span>
            <span>
              Available: {availableQty} {line.unit}
            </span>
            <span>@ {formatCurrency(line.unitPrice)}</span>
          </div>
        </div>
      </div>

      {selected && (
        <div className="mt-3 pl-7 flex items-center gap-4">
          {/* Hidden field for lineId */}
          <input
            type="hidden"
            name={`lines[${index}][lineId]`}
            value={lineId}
          />
          <Label htmlFor={`qty-${lineId}`} className="text-sm">
            Qty to Bill:
          </Label>
          <Input
            id={`qty-${lineId}`}
            name={`lines[${index}][quantity]`}
            type="number"
            min="0.01"
            max={availableQty}
            step="0.01"
            defaultValue={availableQty}
            className="w-24 h-8"
            required
          />
          <span className="text-sm text-muted-foreground">
            / {availableQty} available
          </span>
        </div>
      )}
    </div>
  );
}

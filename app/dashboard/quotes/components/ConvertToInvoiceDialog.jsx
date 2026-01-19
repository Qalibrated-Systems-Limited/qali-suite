"use client";

import { useState, useActionState } from "react";
import {
  ArrowRightCircle,
  Loader2,
  AlertTriangle,
  Calendar,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/utils";
import { convertQuoteToInvoice } from "@/app/mongodb/actions/quote-actions";

export function ConvertToInvoiceDialog({ quote, open, onOpenChange }) {
  // Bind quote ID to action
  const convertWithId = convertQuoteToInvoice.bind(null, quote._id);
  const [state, formAction, isPending] = useActionState(convertWithId, null);

  // Selected items - default all items with available quantity
  const [selectedItems, setSelectedItems] = useState(() => {
    return (quote.items || [])
      .filter((item) => (item.quantity - (item.invoicedQuantity || 0)) > 0)
      .map((item) => ({
        itemId: item._id,
        productId: item.product?.id,
        quantity: item.quantity - (item.invoicedQuantity || 0),
        maxQuantity: item.quantity - (item.invoicedQuantity || 0),
        description: item.product?.name || item.description,
        unitPrice: item.unitPrice,
        selected: true,
      }));
  });

  // Invoice dates
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().split("T")[0];
  });

  // Toggle item selection
  const toggleItem = (itemId) => {
    setSelectedItems(
      selectedItems.map((item) =>
        item.itemId === itemId ? { ...item, selected: !item.selected } : item
      )
    );
  };

  // Update item quantity
  const updateQuantity = (itemId, quantity) => {
    setSelectedItems(
      selectedItems.map((item) =>
        item.itemId === itemId
          ? { ...item, quantity: Math.min(Math.max(0, quantity), item.maxQuantity) }
          : item
      )
    );
  };

  // Select/deselect all
  const toggleAll = (selected) => {
    setSelectedItems(
      selectedItems.map((item) => ({ ...item, selected }))
    );
  };

  // Calculate totals
  const selectedTotal = selectedItems
    .filter((item) => item.selected && item.quantity > 0)
    .reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  const selectedCount = selectedItems.filter(
    (item) => item.selected && item.quantity > 0
  ).length;

  // Build form data
  const formDataValue = JSON.stringify({
    selectedItems: selectedItems
      .filter((item) => item.selected && item.quantity > 0)
      .map((item) => ({
        lineId: item.itemId, // Quote model expects lineId (item._id)
        productId: item.productId,
        quantity: item.quantity,
      })),
    invoiceDate,
    dueDate,
  });

  // Server action handles redirect on success

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightCircle className="h-5 w-5 text-purple-500" />
            Convert to Invoice
          </DialogTitle>
          <DialogDescription>
            Select items from quote {quote.quoteNumber} to include in the invoice.
            You can invoice all items now or select specific items for partial invoicing.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="data" value={formDataValue} />

          {/* Error Display */}
          {state?.error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          {/* Success Display */}
          {state?.success && (
            <Alert className="bg-green-500/10 border-green-500/20">
              <Check className="h-4 w-4 text-green-500" />
              <AlertDescription className="text-green-600 dark:text-green-400">
                {state.message} Redirecting...
              </AlertDescription>
            </Alert>
          )}

          {/* Invoice Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Invoice Date
              </Label>
              <Input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="mt-1"
                disabled={isPending}
              />
            </div>
            <div>
              <Label className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Due Date
              </Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1"
                disabled={isPending}
              />
            </div>
          </div>

          <Separator />

          {/* Items Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Select Items</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleAll(true)}
                  disabled={isPending}
                >
                  Select All
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleAll(false)}
                  disabled={isPending}
                >
                  Deselect All
                </Button>
              </div>
            </div>

            <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
              {selectedItems.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  All items have already been invoiced
                </div>
              ) : (
                selectedItems.map((item) => (
                  <div
                    key={item.itemId}
                    className={`p-3 flex items-start gap-3 ${
                      item.selected ? "bg-muted/30" : ""
                    }`}
                  >
                    <Checkbox
                      id={item.itemId}
                      checked={item.selected}
                      onCheckedChange={() => toggleItem(item.itemId)}
                      disabled={isPending}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor={item.itemId}
                        className="font-medium text-sm text-foreground cursor-pointer"
                      >
                        {item.description}
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Unit Price: {formatCurrency(item.unitPrice)} •
                        Available: {item.maxQuantity}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) =>
                          updateQuantity(item.itemId, Number(e.target.value))
                        }
                        min="0"
                        max={item.maxQuantity}
                        className="w-20 h-8 text-center"
                        disabled={!item.selected || isPending}
                      />
                      <span className="text-sm font-medium w-24 text-right">
                        {formatCurrency(item.quantity * item.unitPrice)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <Separator />

          {/* Summary */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {selectedCount} item(s) selected
            </span>
            <span className="font-bold text-lg">
              Subtotal: {formatCurrency(selectedTotal)}
            </span>
          </div>

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
              disabled={isPending || selectedCount === 0}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Converting...
                </>
              ) : (
                <>
                  <ArrowRightCircle className="mr-2 h-4 w-4" />
                  Create Invoice
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

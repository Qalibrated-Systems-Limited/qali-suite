"use client";

import { useState, useEffect, useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Plus,
  Trash2,
  ReceiptText,
  AlertTriangle,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createCreditNote } from "@/app/mongodb/actions/credit-note-actions";
import { toast } from "sonner";

const REASONS = [
  { value: "return", label: "Goods Returned" },
  { value: "damaged", label: "Damaged Goods" },
  { value: "overcharge", label: "Price Correction (Overcharge)" },
  { value: "cancellation", label: "Order Cancellation" },
  { value: "discount", label: "Post-Sale Discount" },
  { value: "defective", label: "Defective Goods" },
  { value: "other", label: "Other" },
];

export function IssueCreditNoteDialog({ open, onOpenChange, invoice }) {
  const router = useRouter();

  // Form state
  const [reason, setReason] = useState("");
  const [reasonDescription, setReasonDescription] = useState("");
  const [issueImmediately, setIssueImmediately] = useState(true);
  const [items, setItems] = useState([]);

  // Initialize items from invoice when dialog opens
  useEffect(() => {
    if (open && invoice?.items) {
      setItems(
        invoice.items.map((item, index) => ({
          selected: false,
          originalItemIndex: index,
          itemType: item.itemType || "product",
          productId: item.productId || "",
          productSKU: item.productSKU || "",
          productName: item.productName || item.description,
          description: item.description,
          unit: item.unit || "pcs",
          quantity: 0, // Default to 0, user must specify
          maxQuantity: item.quantity,
          originalQuantity: item.quantity,
          originalUnitPrice: item.unitPrice,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate || 16,
          restoreInventory: item.itemType === "product",
        }))
      );
      setReason("");
      setReasonDescription("");
    }
  }, [open, invoice]);

  // Create action with bound invoice ID
  const boundCreateCreditNote = async (prevState, formData) => {
    formData.append("invoiceId", invoice._id);
    return createCreditNote(prevState, formData);
  };

  const [state, formAction, isPending] = useActionState(
    boundCreateCreditNote,
    null
  );

  // Handle success
  useEffect(() => {
    if (state?.success) {
      toast.success("Credit note created", {
        description: `Credit note ${state.creditNoteNumber} has been ${
          state.status === "issued" ? "issued" : "created as draft"
        }`,
      });
      onOpenChange(false);
      router.refresh();
    }
  }, [state, onOpenChange, router]);

  // Calculate totals
  const selectedItems = items.filter((item) => item.selected && item.quantity > 0);
  const subtotal = selectedItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );
  const taxAmount = selectedItems.reduce(
    (sum, item) => sum + (item.quantity * item.unitPrice * item.taxRate) / 100,
    0
  );
  const total = subtotal + taxAmount;

  const handleItemChange = (index, field, value) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;

        const updates = { [field]: value };

        // Auto-select when quantity is entered
        if (field === "quantity" && value > 0 && !item.selected) {
          updates.selected = true;
        }

        // Ensure quantity doesn't exceed original
        if (field === "quantity") {
          updates.quantity = Math.min(Math.max(0, value), item.maxQuantity);
        }

        return { ...item, ...updates };
      })
    );
  };

  const handleSelectAll = (checked) => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        selected: checked,
        quantity: checked ? item.maxQuantity : 0,
      }))
    );
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="w-5 h-5 text-red-500" />
            Issue Credit Note
          </DialogTitle>
          <DialogDescription>
            Create a credit note for invoice {invoice?.invoiceNumber}. Select
            the items to credit and specify quantities.
          </DialogDescription>
        </DialogHeader>

        {state?.error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        <form action={formAction} className="space-y-6">
          {/* Hidden fields */}
          <input type="hidden" name="creditNoteDate" value={new Date().toISOString()} />
          <input type="hidden" name="issueImmediately" value={issueImmediately.toString()} />

          {/* Reason Section */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason *</Label>
              <Select
                name="reason"
                value={reason}
                onValueChange={setReason}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select reason..." />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reasonDescription">Description *</Label>
              <Input
                id="reasonDescription"
                name="reasonDescription"
                placeholder="Brief description..."
                value={reasonDescription}
                onChange={(e) => setReasonDescription(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Items Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Items to Credit</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="selectAll"
                  checked={items.every((item) => item.selected)}
                  onCheckedChange={handleSelectAll}
                />
                <label
                  htmlFor="selectAll"
                  className="text-sm text-muted-foreground cursor-pointer"
                >
                  Select All (Full Quantities)
                </label>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left w-8"></th>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-right w-24">Available</th>
                    <th className="px-3 py-2 text-right w-28">Credit Qty</th>
                    <th className="px-3 py-2 text-right w-24">Price</th>
                    <th className="px-3 py-2 text-right w-28">Amount</th>
                    <th className="px-3 py-2 text-center w-20">Restore</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item, index) => (
                    <tr
                      key={index}
                      className={item.selected ? "bg-red-50/50 dark:bg-red-950/20" : ""}
                    >
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={item.selected}
                          onCheckedChange={(checked) =>
                            handleItemChange(index, "selected", checked)
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{item.productName}</div>
                        {item.productSKU && (
                          <div className="text-xs text-muted-foreground">
                            SKU: {item.productSKU}
                          </div>
                        )}
                        {/* Hidden form fields for items */}
                        {item.selected && item.quantity > 0 && (
                          <>
                            <input type="hidden" name={`items[${index}].originalItemIndex`} value={item.originalItemIndex} />
                            <input type="hidden" name={`items[${index}].itemType`} value={item.itemType} />
                            <input type="hidden" name={`items[${index}].productId`} value={item.productId || ""} />
                            <input type="hidden" name={`items[${index}].productSKU`} value={item.productSKU || ""} />
                            <input type="hidden" name={`items[${index}].productName`} value={item.productName || ""} />
                            <input type="hidden" name={`items[${index}].description`} value={item.description} />
                            <input type="hidden" name={`items[${index}].unit`} value={item.unit} />
                            <input type="hidden" name={`items[${index}].quantity`} value={item.quantity} />
                            <input type="hidden" name={`items[${index}].originalQuantity`} value={item.originalQuantity} />
                            <input type="hidden" name={`items[${index}].originalUnitPrice`} value={item.originalUnitPrice} />
                            <input type="hidden" name={`items[${index}].unitPrice`} value={item.unitPrice} />
                            <input type="hidden" name={`items[${index}].taxRate`} value={item.taxRate} />
                            <input type="hidden" name={`items[${index}].restoreInventory`} value={item.restoreInventory.toString()} />
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {item.maxQuantity} {item.unit}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          min="0"
                          max={item.maxQuantity}
                          step="1"
                          value={item.quantity}
                          onChange={(e) =>
                            handleItemChange(index, "quantity", parseFloat(e.target.value) || 0)
                          }
                          className="w-24 text-right h-8"
                          disabled={!item.selected}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatCurrency(item.unitPrice)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {item.selected && item.quantity > 0
                          ? formatCurrency(item.quantity * item.unitPrice)
                          : "-"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.itemType === "product" && (
                          <Checkbox
                            checked={item.restoreInventory}
                            onCheckedChange={(checked) =>
                              handleItemChange(index, "restoreInventory", checked)
                            }
                            disabled={!item.selected}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          {selectedItems.length > 0 && (
            <div className="flex justify-end">
              <div className="w-64 space-y-2 bg-muted/50 rounded-lg p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">VAT (16%):</span>
                  <span>{formatCurrency(taxAmount)}</span>
                </div>
                <div className="flex justify-between font-bold text-red-600 dark:text-red-400 border-t pt-2">
                  <span>Credit Total:</span>
                  <span>{formatCurrency(total)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Additional notes..."
              rows={2}
            />
          </div>

          {/* Issue Immediately Checkbox */}
          <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
            <Checkbox
              id="issueImmediately"
              checked={issueImmediately}
              onCheckedChange={setIssueImmediately}
            />
            <label
              htmlFor="issueImmediately"
              className="text-sm cursor-pointer"
            >
              <span className="font-medium">Issue immediately</span>
              <span className="text-muted-foreground ml-1">
                (Create journal entries and update invoice)
              </span>
            </label>
          </div>

          <DialogFooter>
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
              disabled={isPending || selectedItems.length === 0 || !reason || !reasonDescription}
              className="bg-red-600 hover:bg-red-700"
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              {issueImmediately ? "Issue Credit Note" : "Save as Draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useActionState, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { expenseInternalCheckout } from "@/app/mongodb/checkout-action";
import { Receipt, Loader2, Package, User, AlertCircle } from "lucide-react";
import ExpenseAccountCombobox from "@/components/expense-account-combobox";

export function ExpenseInternalDialog({
  checkout,
  expenseAccounts = [],
  open,
  onOpenChange,
}) {
  const [state, formAction, isPending] = useActionState(
    expenseInternalCheckout.bind(null, checkout._id),
    {
      message: "",
    }
  );

  const [selectedAccount, setSelectedAccount] = useState("");
  const [quantity, setQuantity] = useState(checkout.quantity);
  const [allAccounts, setAllAccounts] = useState(expenseAccounts);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setQuantity(checkout.quantity);
      setSelectedAccount("");
    }
  }, [open, checkout.quantity]);

  // Calculate cost preview
  const unitCost = checkout.product?.costPrice || 0;
  const totalCost = unitCost * quantity;

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-purple-500" />
            Expense Internal Item
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Record this internal use item as an expense
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <div className="space-y-4 py-4">
            {/* Checkout Info */}
            <div className="space-y-2 p-3 bg-purple-500/5 rounded-lg border border-purple-500/20">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  Product:
                </span>
                <span className="font-medium">
                  {checkout.productSnapshot?.name}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" />
                  Checked Out To:
                </span>
                <span>{checkout.checkedOutTo?.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Checkout #:</span>
                <span className="font-mono text-xs">
                  {checkout.checkoutNumber}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Request Type:</span>
                <span className="capitalize text-purple-500 font-medium">
                  {checkout.requestType}
                </span>
              </div>
            </div>

            {/* Expense Account Selection */}
            <div className="space-y-2">
              <Label>
                Expense Account <span className="text-red-500">*</span>
              </Label>
              <ExpenseAccountCombobox
                value={selectedAccount}
                onValueChange={(id) => setSelectedAccount(id)}
                accounts={allAccounts}
                onAccountCreated={(acc) =>
                  setAllAccounts((prev) =>
                    [...prev, acc].sort((a, b) =>
                      a.accountCode.localeCompare(b.accountCode),
                    ),
                  )
                }
                placeholder="Select expense account..."
              />
              <input
                type="hidden"
                name="expenseAccountId"
                value={selectedAccount}
              />
            </div>

            {/* Quantity */}
            <div className="space-y-2">
              <Label htmlFor="quantity">
                Quantity to Expense
              </Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min="1"
                max={checkout.quantity}
                value={quantity}
                onChange={(e) => setQuantity(Math.min(parseInt(e.target.value) || 1, checkout.quantity))}
                className="bg-background border-border"
              />
              <p className="text-xs text-muted-foreground">
                Max: {checkout.quantity} (checked out quantity)
              </p>
            </div>

            {/* Cost Preview */}
            <div className="p-3 bg-muted/50 rounded-lg space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Unit Cost:</span>
                <span>{formatCurrency(unitCost)}</span>
              </div>
              <div className="flex justify-between text-sm font-medium">
                <span>Total Cost to Expense:</span>
                <span className="text-purple-500">{formatCurrency(totalCost)}</span>
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="reason">
                Reason / Notes
              </Label>
              <Textarea
                id="reason"
                name="reason"
                placeholder="Why is this being expensed? e.g., Office supplies consumed, Equipment for internal use..."
                defaultValue={`Internal use - ${checkout.purpose || "consumed"}`}
                className="bg-background border-border"
                rows={3}
              />
            </div>

            {/* Warning */}
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                This action will create a journal entry debiting the selected expense account
                and crediting Technician Stock. This cannot be undone.
              </p>
            </div>

            {/* Error Message */}
            {state.message && state.message !== "success" && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-sm text-red-500">{state.message}</p>
              </div>
            )}
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
              disabled={isPending || !selectedAccount}
              className="bg-purple-600 text-white hover:bg-purple-700"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Receipt className="mr-2 h-4 w-4" />
                  Record Expense
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

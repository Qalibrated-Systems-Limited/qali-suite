"use client";

import { useState } from "react";
import { useActionState } from "react";
import { paySettlementBalance } from "../../../mongodb/actions/claim-action";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpRight, Loader2, Banknote } from "lucide-react";

/**
 * Pay Balance Dialog
 * Used by accountant to pay extra amount to employee
 * When: settlement status is "pending_payment" (company owes employee)
 */
export function PayBalanceDialog({
  settlementId,
  claimNumber,
  balance, // This will be negative, so we use Math.abs()
  employeeName,
}) {
  const [open, setOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");

  const payBalanceWithId = paySettlementBalance.bind(null, settlementId);
  const [state, formAction, isPending] = useActionState(payBalanceWithId, {});

  const amountToPay = Math.abs(balance);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  // Close dialog on success
  if (state?.success && open) {
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          <Banknote className="w-4 h-4 mr-2" />
          Pay Employee
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay Settlement Balance</DialogTitle>
          <DialogDescription>
            Pay additional amount to {employeeName} for {claimNumber}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <div className="space-y-5 py-4">
            {/* Balance Info */}
            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <p className="text-sm text-muted-foreground mb-1">
                Amount to Pay
              </p>
              <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                {formatCurrency(amountToPay)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Company owes this to employee
              </p>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label htmlFor="paymentMethod">
                Payment Method <span className="text-red-500">*</span>
              </Label>
              <Select
                name="paymentMethod"
                value={paymentMethod}
                onValueChange={setPaymentMethod}
                required
              >
                <SelectTrigger id="paymentMethod">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="mpesa">M-Pesa</SelectItem>
                </SelectContent>
              </Select>
              {state?.errors?.paymentMethod && (
                <p className="text-sm text-red-500">
                  {state.errors.paymentMethod[0]}
                </p>
              )}
            </div>

            {/* Reference */}
            <div className="space-y-2">
              <Label htmlFor="reference">Reference (Optional)</Label>
              <Input
                id="reference"
                name="reference"
                placeholder="e.g., Transaction ID, M-Pesa code"
              />
              {state?.errors?.reference && (
                <p className="text-sm text-red-500">
                  {state.errors.reference[0]}
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                name="notes"
                placeholder="Any additional notes..."
                rows={2}
              />
              {state?.errors?.notes && (
                <p className="text-sm text-red-500">{state.errors.notes[0]}</p>
              )}
            </div>

            {/* Form Error */}
            {state?.errors?._form && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">
                  {state.errors._form[0]}
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !paymentMethod}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Banknote className="w-4 h-4 mr-2" />
                  Pay {formatCurrency(amountToPay)}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

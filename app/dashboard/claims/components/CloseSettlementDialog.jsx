"use client";

import { useState } from "react";
import { useActionState } from "react";
import { closeSettlement } from "../../../mongodb/actions/claim-action";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Loader2, Calculator } from "lucide-react";

/**
 * Close Settlement Dialog
 * Used by accountant to process an approved advance_return claim
 * Creates the settlement journal entry
 */
export function CloseSettlementDialog({
  settlementId,
  claimNumber,
  advanceAmount,
  totalSpent,
  balance,
  employeeName,
}) {
  const [open, setOpen] = useState(false);

  const closeSettlementWithId = closeSettlement.bind(null, settlementId);
  const [state, formAction, isPending] = useActionState(
    closeSettlementWithId,
    {}
  );

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
          className="bg-purple-600 hover:bg-purple-700 text-white"
        >
          <Calculator className="w-4 h-4 mr-2" />
          Process Settlement
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Process Settlement</DialogTitle>
          <DialogDescription>
            Review and close settlement for {employeeName} - {claimNumber}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <div className="space-y-5 py-4">
            {/* Settlement Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Advance Amount */}
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-muted-foreground mb-1">
                  Advance Given
                </p>
                <p className="text-lg font-bold text-blue-700 dark:text-blue-400">
                  {formatCurrency(advanceAmount)}
                </p>
              </div>

              {/* Total Spent */}
              <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                <p className="text-xs text-muted-foreground mb-1">
                  Total Spent
                </p>
                <p className="text-lg font-bold text-purple-700 dark:text-purple-400">
                  {formatCurrency(totalSpent)}
                </p>
              </div>

              {/* Balance */}
              <div
                className={`p-3 rounded-lg border ${
                  balance > 0
                    ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                    : balance < 0
                    ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                    : "bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800"
                }`}
              >
                <p className="text-xs text-muted-foreground mb-1">Balance</p>
                <p
                  className={`text-lg font-bold ${
                    balance > 0
                      ? "text-red-700 dark:text-red-400"
                      : balance < 0
                      ? "text-green-700 dark:text-green-400"
                      : "text-gray-700 dark:text-gray-400"
                  }`}
                >
                  {formatCurrency(Math.abs(balance))}
                </p>
              </div>
            </div>

            {/* Balance Explanation */}
            <div
              className={`p-4 rounded-lg border ${
                balance > 0
                  ? "bg-red-50/50 dark:bg-red-900/10 border-red-200 dark:border-red-800"
                  : balance < 0
                  ? "bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800"
                  : "bg-gray-50/50 dark:bg-gray-900/10 border-gray-200 dark:border-gray-800"
              }`}
            >
              {balance > 0 ? (
                <>
                  <p className="font-semibold text-red-700 dark:text-red-400 mb-1">
                    Employee owes {formatCurrency(balance)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    After processing, you'll need to record the cash return from{" "}
                    {employeeName}.
                  </p>
                </>
              ) : balance < 0 ? (
                <>
                  <p className="font-semibold text-green-700 dark:text-green-400 mb-1">
                    Company owes {formatCurrency(Math.abs(balance))}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    After processing, you'll need to pay the additional amount
                    to {employeeName}.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-gray-700 dark:text-gray-400 mb-1">
                    Exactly Balanced
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Employee spent exactly the advance amount. Settlement will
                    be closed automatically.
                  </p>
                </>
              )}
            </div>

            {/* Journal Entry Preview */}
            <div className="p-4 bg-muted/50 rounded-lg border">
              <p className="text-sm font-semibold mb-3">
                Journal Entry Preview:
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    DR: Expense Accounts
                  </span>
                  <span className="font-mono">
                    {formatCurrency(totalSpent)}
                  </span>
                </div>
                {balance >= 0 ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      CR: Employee Advance
                    </span>
                    <span className="font-mono">
                      {formatCurrency(totalSpent)}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        CR: Employee Advance
                      </span>
                      <span className="font-mono">
                        {formatCurrency(advanceAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        CR: Employee Payables
                      </span>
                      <span className="font-mono">
                        {formatCurrency(Math.abs(balance))}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                name="notes"
                placeholder="Any additional notes for this settlement..."
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

            {/* Success Message */}
            {state?.success && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-sm text-green-600 dark:text-green-400">
                  {state.message}
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
              disabled={isPending}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Process Settlement
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

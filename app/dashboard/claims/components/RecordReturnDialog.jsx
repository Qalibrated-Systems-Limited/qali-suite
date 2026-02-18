"use client";

import { useState } from "react";
import { useActionState } from "react";
import { recordAdvanceReturn } from "../../../mongodb/actions/claim-action";
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
import {
  ArrowDownLeft,
  Loader2,
  Banknote,
  Smartphone,
  Building2,
  DollarSign,
} from "lucide-react";

const SUBTYPE_ICONS = {
  mpesa: Smartphone,
  bank: Building2,
  cash: Banknote,
};

const SUBTYPE_COLORS = {
  mpesa: "text-green-600",
  bank: "text-blue-600",
  cash: "text-emerald-600",
};

/**
 * Record Return Dialog
 * Used by accountant to record cash return from employee
 * When: settlement status is "pending_return" (employee owes company)
 */
export function RecordReturnDialog({
  settlementId,
  claimNumber,
  balance,
  employeeName,
  paymentAccounts = [],
}) {
  const [open, setOpen] = useState(false);
  const [paymentAccountId, setPaymentAccountId] = useState("");

  const recordReturnWithId = recordAdvanceReturn.bind(null, settlementId);
  const [state, formAction, isPending] = useActionState(recordReturnWithId, null);

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
        <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white">
          <ArrowDownLeft className="w-4 h-4 mr-2" />
          Record Return
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Cash Return</DialogTitle>
          <DialogDescription>
            Record cash return from {employeeName} for {claimNumber}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <div className="space-y-5 py-4">
            {/* Balance Info */}
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-sm text-muted-foreground mb-1">
                Amount to Return
              </p>
              <p className="text-2xl font-bold text-red-700 dark:text-red-400">
                {formatCurrency(balance)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Employee owes this amount
              </p>
            </div>

            {/* Payment Account */}
            <div className="space-y-2">
              <Label htmlFor="paymentAccountId">
                Receiving Account <span className="text-red-500">*</span>
              </Label>
              <Select
                name="paymentAccountId"
                value={paymentAccountId}
                onValueChange={setPaymentAccountId}
                required
              >
                <SelectTrigger id="paymentAccountId">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {paymentAccounts.map((account) => {
                    const Icon = SUBTYPE_ICONS[account.subType] || DollarSign;
                    const color = SUBTYPE_COLORS[account.subType] || "";
                    return (
                      <SelectItem key={account._id} value={account._id}>
                        <span className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${color}`} />
                          {account.accountCode} - {account.accountName}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {state?.errors?.paymentAccountId && (
                <p className="text-sm text-red-500">
                  {state.errors.paymentAccountId[0]}
                </p>
              )}
              {state?.errors?.paymentMethod && (
                <p className="text-sm text-red-500">
                  {state.errors.paymentMethod[0]}
                </p>
              )}
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <Label htmlFor="amount">Amount Returned</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                max={balance}
                defaultValue={balance}
                placeholder="Enter amount"
              />
              <p className="text-xs text-muted-foreground">
                Leave as is to record full return, or enter partial amount
              </p>
              {state?.errors?.amount && (
                <p className="text-sm text-red-500">{state.errors.amount[0]}</p>
              )}
            </div>

            {/* Reference */}
            <div className="space-y-2">
              <Label htmlFor="reference">Reference (Optional)</Label>
              <Input
                id="reference"
                name="reference"
                placeholder="e.g., Receipt number, M-Pesa code"
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
              disabled={isPending || !paymentAccountId}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Recording...
                </>
              ) : (
                <>
                  <ArrowDownLeft className="w-4 h-4 mr-2" />
                  Record Return
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  Loader2,
  AlertCircle,
  Banknote,
  Smartphone,
  Building2,
} from "lucide-react";
import {
  payAdvance,
  payReimbursement,
} from "../../../mongodb/actions/claim-action";
import { toast } from "sonner";

/**
 * Pay Claim Dialog
 * Used by accountant to pay approved advance_request or reimbursement claims
 *
 * Handles two claim types:
 * - advance_request: Creates DR: Employee Advance, CR: Cash/Bank
 * - reimbursement: Creates expense JE + payment JE
 */
export function PayClaimDialog({
  claimId,
  claimNumber,
  claimType,
  amount,
  employeeName,
  children,
}) {
  const [open, setOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const router = useRouter();

  // Use appropriate action based on claim type
  const payAction =
    claimType === "advance_request" ? payAdvance : payReimbursement;
  const payWithId = payAction.bind(null, claimId);

  const [state, formAction, isPending] = useActionState(payWithId, {});

  // Handle state changes
  useEffect(() => {
    if (state?.success) {
      toast.success(state.message || "Payment processed successfully");
      setOpen(false);
      setPaymentMethod(""); // Reset form
      router.refresh();
    }
  }, [state, router]);

  const formatCurrency = (amt) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(amt);
  };

  const getClaimTypeLabel = () => {
    if (claimType === "advance_request") return "Advance";
    if (claimType === "reimbursement") return "Reimbursement";
    return "Claim";
  };

  const getPaymentMethodIcon = (method) => {
    switch (method) {
      case "mpesa":
        return <Smartphone className="w-4 h-4" />;
      case "bank":
        return <Building2 className="w-4 h-4" />;
      case "cash":
        return <Banknote className="w-4 h-4" />;
      default:
        return <DollarSign className="w-4 h-4" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button
            size="sm"
            className="bg-yellow-500 hover:bg-yellow-600 text-black"
          >
            <DollarSign className="w-4 h-4 mr-2" />
            Pay {getClaimTypeLabel()}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Process {getClaimTypeLabel()} Payment</DialogTitle>
          <DialogDescription>
            Pay {claimNumber} to {employeeName}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <div className="space-y-5 py-4">
            {/* General Error */}
            {state?.errors?._form && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-800 dark:text-red-300">
                      Payment Failed
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                      {state.errors._form[0]}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Payment Summary */}
            <div className="p-4 bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    Employee
                  </span>
                  <span className="font-medium text-foreground">
                    {employeeName}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Type</span>
                  <span className="font-medium text-foreground">
                    {getClaimTypeLabel()}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-yellow-200 dark:border-yellow-800">
                  <span className="text-sm font-medium text-muted-foreground">
                    Amount
                  </span>
                  <span className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">
                    {formatCurrency(amount)}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label htmlFor="paymentMethod">
                Payment Method <span className="text-red-500">*</span>
              </Label>
              <Select
                name="paymentMethod"
                required
                value={paymentMethod}
                onValueChange={setPaymentMethod}
              >
                <SelectTrigger id="paymentMethod">
                  <SelectValue placeholder="Select how to pay" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mpesa">
                    <span className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-green-600" />
                      M-Pesa
                    </span>
                  </SelectItem>
                  <SelectItem value="bank">
                    <span className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-blue-600" />
                      Bank Transfer
                    </span>
                  </SelectItem>
                  <SelectItem value="cash">
                    <span className="flex items-center gap-2">
                      <Banknote className="w-4 h-4 text-emerald-600" />
                      Cash
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {state?.errors?.paymentMethod && (
                <p className="text-sm text-red-500">
                  {state.errors.paymentMethod[0]}
                </p>
              )}
            </div>

            {/* Payment Reference */}
            <div className="space-y-2">
              <Label htmlFor="paymentReference">
                Reference{" "}
                <span className="text-muted-foreground font-normal">
                  (Optional)
                </span>
              </Label>
              <Input
                id="paymentReference"
                name="paymentReference"
                placeholder={
                  paymentMethod === "mpesa"
                    ? "e.g., QWE123ABC"
                    : paymentMethod === "bank"
                    ? "e.g., TXN-2025-001234"
                    : "e.g., Receipt #123"
                }
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                Transaction ID or receipt number for tracking
              </p>
              {state?.errors?.paymentReference && (
                <p className="text-sm text-red-500">
                  {state.errors.paymentReference[0]}
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="paymentNotes">
                Notes{" "}
                <span className="text-muted-foreground font-normal">
                  (Optional)
                </span>
              </Label>
              <Textarea
                id="paymentNotes"
                name="paymentNotes"
                placeholder="Any additional notes about this payment..."
                rows={2}
                className="resize-none"
                maxLength={500}
              />
              {state?.errors?.paymentNotes && (
                <p className="text-sm text-red-500">
                  {state.errors.paymentNotes[0]}
                </p>
              )}
            </div>

            {/* Info Banner */}
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-700 dark:text-blue-400">
                {claimType === "advance_request" ? (
                  <>
                    This will create a journal entry recording the advance and
                    deduct from{" "}
                    {paymentMethod === "mpesa"
                      ? "M-Pesa"
                      : paymentMethod === "bank"
                      ? "Bank"
                      : paymentMethod === "cash"
                      ? "Cash"
                      : "your payment account"}
                    .
                  </>
                ) : (
                  <>
                    This will create expense entries and record the payment to
                    the employee.
                  </>
                )}
              </p>
            </div>
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
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {getPaymentMethodIcon(paymentMethod)}
                  <span className="ml-2">Pay {formatCurrency(amount)}</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

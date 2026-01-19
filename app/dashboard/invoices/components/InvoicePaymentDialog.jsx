"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, DollarSign, AlertTriangle } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { createInvoicePayment } from "@/app/mongodb/invoice-actions";

const PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cash", label: "Cash" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "cheque", label: "Cheque" },
];

export function InvoicePaymentDialog({
  open,
  onOpenChange,
  invoice,
  paymentAccounts = [],
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // Form state
  const [amount, setAmount] = useState(invoice?.amountDue?.toString() || "");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const balance = invoice?.amountDue || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData();
    formData.append("amount", amount);
    formData.append("paymentMethod", paymentMethod);
    formData.append("accountId", accountId);
    formData.append("paymentDate", paymentDate);
    formData.append("reference", reference);
    formData.append("notes", notes);

    startTransition(async () => {
      const result = await createInvoicePayment(invoice._id, null, formData);

      if (result.success) {
        toast.success(result.message);
        onOpenChange(false);
        router.refresh();
        // Reset form
        setAmount("");
        setPaymentMethod("");
        setAccountId("");
        setReference("");
        setNotes("");
      } else {
        setError(result.error);
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
        }
      }
    });
  };

  const handleClose = () => {
    if (!isPending) {
      setError(null);
      setFieldErrors({});
      onOpenChange(false);
    }
  };

  // Reset amount when dialog opens with new invoice
  const handleOpenChange = (open) => {
    if (open && invoice) {
      setAmount(invoice.amountDue?.toString() || "");
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Receive Payment
          </DialogTitle>
          <DialogDescription>
            Record a payment for invoice {invoice?.invoiceNumber}. Outstanding
            balance:{" "}
            <span className="font-semibold text-foreground">
              KES{" "}
              {balance.toLocaleString("en-KE", { minimumFractionDigits: 2 })}
            </span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">
              Amount <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                KES
              </span>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                max={balance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={`pl-12 ${
                  fieldErrors.amount ? "border-destructive" : ""
                }`}
                disabled={isPending}
              />
            </div>
            {fieldErrors.amount && (
              <p className="text-sm text-destructive">{fieldErrors.amount}</p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(balance.toString())}
                disabled={isPending}
              >
                Pay Full Balance
              </Button>
            </div>
          </div>

          {/* Payment Date */}
          <div className="space-y-2">
            <Label htmlFor="paymentDate">
              Payment Date <span className="text-destructive">*</span>
            </Label>
            <Input
              id="paymentDate"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              disabled={isPending}
            />
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label htmlFor="paymentMethod">
              Payment Method <span className="text-destructive">*</span>
            </Label>
            <Select
              value={paymentMethod}
              onValueChange={setPaymentMethod}
              disabled={isPending}
            >
              <SelectTrigger
                className={
                  fieldErrors.paymentMethod ? "border-destructive" : ""
                }
              >
                <SelectValue placeholder="Select payment method" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.paymentMethod && (
              <p className="text-sm text-destructive">
                {fieldErrors.paymentMethod}
              </p>
            )}
          </div>

          {/* Payment Account */}
          <div className="space-y-2">
            <Label htmlFor="accountId">
              Deposit Account <span className="text-destructive">*</span>
            </Label>
            <Select
              value={accountId}
              onValueChange={setAccountId}
              disabled={isPending}
            >
              <SelectTrigger
                className={fieldErrors.accountId ? "border-destructive" : ""}
              >
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {paymentAccounts.map((account) => (
                  <SelectItem key={account._id} value={account._id}>
                    {account.code} - {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.accountId && (
              <p className="text-sm text-destructive">
                {fieldErrors.accountId}
              </p>
            )}
            {paymentAccounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No payment accounts available. Please add cash, bank, or M-Pesa
                accounts.
              </p>
            )}
          </div>

          {/* Reference */}
          <div className="space-y-2">
            <Label htmlFor="reference">Reference / Transaction ID</Label>
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g., Cheque number, M-Pesa code"
              disabled={isPending}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional payment notes..."
              rows={2}
              disabled={isPending}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || paymentAccounts.length === 0}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <DollarSign className="mr-2 h-4 w-4" />
                  Receive Payment
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

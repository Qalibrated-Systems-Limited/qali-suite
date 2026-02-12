"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Edit,
  Trash2,
  Send,
  CheckCircle2,
  XCircle,
  Wallet,
  Loader2,
  MoreHorizontal,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  submitExpense,
  approveExpense,
  rejectExpense,
  markExpenseAsPaid,
  deleteExpense,
} from "@/app/mongodb/actions/expense-actions";

export default function ExpenseActions({ expense, paymentAccounts = [] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Dialog states
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Form states
  const [rejectReason, setRejectReason] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paidFrom, setPaidFrom] = useState("");
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);

  // Find selected account for display
  const selectedAccount = paymentAccounts.find((a) => a._id === paidFrom);

  const handleAction = async (action, formData = null) => {
    setLoading(true);
    setError(null);

    try {
      let result;

      switch (action) {
        case "submit":
          result = await submitExpense(expense._id);
          break;
        case "approve":
          result = await approveExpense(expense._id);
          break;
        case "reject":
          result = await rejectExpense(expense._id, {}, formData);
          setShowRejectDialog(false);
          break;
        case "pay":
          result = await markExpenseAsPaid(expense._id, {}, formData);
          setShowPayDialog(false);
          break;
        case "delete":
          result = await deleteExpense(expense._id);
          if (result.success) {
            router.push("/dashboard/expenses");
            return;
          }
          break;
      }

      if (!result?.success) {
        setError(result?.error || "Action failed");
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = () => {
    const formData = new FormData();
    formData.append("reason", rejectReason);
    handleAction("reject", formData);
  };

  const handlePay = () => {
    const formData = new FormData();
    formData.append("paymentMethod", paymentMethod);
    formData.append("paidFrom", paidFrom);
    formData.append("paidAt", new Date().toISOString());
    handleAction("pay", formData);
  };

  return (
    <>
      {/* Error Display */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg shadow-lg text-sm z-50">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Primary Actions based on status */}
        {expense.status === "draft" && (
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/expenses/${expense._id}/edit`}>
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => handleAction("submit")}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Submit
            </Button>
          </>
        )}

        {expense.status === "pending" && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRejectDialog(true)}
              disabled={loading}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => handleAction("approve")}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              Approve
            </Button>
          </>
        )}

        {expense.status === "approved" && (
          <Button
            size="sm"
            onClick={() => setShowPayDialog(true)}
            disabled={loading}
          >
            <Wallet className="w-4 h-4 mr-2" />
            Mark as Paid
          </Button>
        )}

        {expense.status === "rejected" && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/expenses/${expense._id}/edit`}>
              <Edit className="w-4 h-4 mr-2" />
              Edit & Resubmit
            </Link>
          </Button>
        )}

        {/* More Actions */}
        {(expense.status === "draft" || expense.status === "rejected") && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Expense</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this expense. The submitter
              will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason for Rejection</Label>
              <Textarea
                id="reason"
                placeholder="e.g., Missing receipt, incorrect category, not approved..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRejectDialog(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={loading || !rejectReason.trim()}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4 mr-2" />
              )}
              Reject Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Dialog */}
      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Record payment details for this expense. A journal entry will be
              created automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="paymentMethod">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="mpesa">M-Pesa</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Paid From Account</Label>
              <Popover open={accountPickerOpen} onOpenChange={setAccountPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={accountPickerOpen}
                    className={cn(
                      "w-full justify-between font-normal",
                      !paidFrom && "text-muted-foreground"
                    )}
                  >
                    {selectedAccount
                      ? `${selectedAccount.accountCode} - ${selectedAccount.accountName}`
                      : "Select payment account..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search accounts..." />
                    <CommandList>
                      <CommandEmpty>No accounts found.</CommandEmpty>
                      <CommandGroup>
                        {paymentAccounts.map((account) => (
                          <CommandItem
                            key={account._id}
                            value={`${account.accountCode} ${account.accountName}`}
                            onSelect={() => {
                              setPaidFrom(account._id);
                              setAccountPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                paidFrom === account._id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="font-mono text-xs mr-2">{account.accountCode}</span>
                            {account.accountName}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                Select the cash/bank account used for payment
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowPayDialog(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePay}
              disabled={loading || !paidFrom}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Wallet className="w-4 h-4 mr-2" />
              )}
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Expense</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete expense {expense.expenseNumber}?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowDeleteDialog(false);
                handleAction("delete");
              }}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

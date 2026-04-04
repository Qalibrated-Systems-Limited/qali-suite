"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Trash2,
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
  recordExpensePayment,
  deleteExpense,
  postLegacyExpense,
} from "@/app/mongodb/actions/expense-actions";

export default function ExpenseActions({ expense, paymentAccounts = [] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Dialog states
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Payment form states
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paidFrom, setPaidFrom] = useState("");
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);

  const selectedAccount = paymentAccounts.find((a) => a._id === paidFrom);

  const handlePay = async () => {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("paymentMethod", paymentMethod);
      formData.append("paidFrom", paidFrom);
      formData.append("paidAt", new Date().toISOString());

      const result = await recordExpensePayment(expense._id, {}, formData);
      if (!result?.success) {
        setError(result?.error || "Failed to record payment");
      } else {
        setShowPayDialog(false);
        router.refresh();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await deleteExpense(expense._id);
      if (result?.success) {
        router.push("/dashboard/expenses");
        return;
      }
      setError(result?.error || "Failed to delete");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setShowDeleteDialog(false);
    }
  };

  const handlePostLegacy = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await postLegacyExpense(expense._id);
      if (!result?.success) {
        setError(result?.error || "Failed to post expense");
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Determine which actions to show
  const isLegacy = ["pending", "approved", "rejected"].includes(expense.status);
  const isUnpaid = expense.paymentStatus === "unpaid" &&
    ["posted", "approved"].includes(expense.status);
  const canDelete = expense.status === "draft";

  return (
    <>
      {error && (
        <div className="fixed bottom-4 right-4 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg shadow-lg text-sm z-50">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Legacy migration — post old pending/approved/rejected expenses */}
        {isLegacy && (
          <Button
            size="sm"
            onClick={handlePostLegacy}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Wallet className="w-4 h-4 mr-2" />
            )}
            Post Now
          </Button>
        )}

        {/* Record Payment — only for unpaid posted expenses */}
        {isUnpaid && !isLegacy && (
          <Button
            size="sm"
            onClick={() => setShowPayDialog(true)}
            disabled={loading}
          >
            <Wallet className="w-4 h-4 mr-2" />
            Record Payment
          </Button>
        )}

        {/* More actions */}
        {canDelete && (
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

      {/* Pay Dialog */}
      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Record payment for this expense. A clearing journal entry
              (DR Accrued Expenses / CR Cash or Bank) will be created.
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
              onClick={handleDelete}
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

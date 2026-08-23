"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Trash2,
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
import { Input } from "@/components/ui/input";
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
  recordExpensePaymentPg,
  deleteExpensePg,
  voidExpensePg,
} from "@/app/db/actions/expense-actions";

export default function ExpenseActions({ expense, paymentAccounts = [] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Dialog states
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState("");

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

      const result = await recordExpensePaymentPg(expense._id, {}, formData);
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
      const result = await deleteExpensePg(expense._id);
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

  /**
   * Void — reverse every entry this expense raised.
   *
   * This replaces "Post Now", which existed to rescue two states that no
   * longer occur: a legacy pending/approved/rejected expense, and a draft
   * stranded when auto-post threw. Create-and-post is one transaction now, so
   * neither is expressible.
   *
   * And it is the correction path. Mongo carried the `void` status, `voidedAt`,
   * `voidedBy` and `voidReason` — and nothing wrote any of them, while delete
   * refused a posted expense with "void it instead". Since every expense is
   * posted on creation, an expense could not be undone at all.
   */
  const handleVoid = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await voidExpensePg(expense._id, voidReason);
      if (!result?.success) {
        setError(result?.error || "Failed to void expense");
      } else {
        setShowVoidDialog(false);
        router.refresh();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Which actions to show.
  //
  // No "Post Now": the legacy statuses are gone, and the draft it also
  // rescued cannot be stranded any more — create-and-post is one transaction.
  const isUnpaid =
    expense.paymentStatus === "unpaid" && expense.status === "posted";
  // Draft is the only deletable state, and nothing produces one — so this is
  // effectively never true. It stays because the repository enforces the same
  // rule, and a button that lies about what it will do is worse than one that
  // never appears.
  const canDelete = expense.status === "draft";
  const canVoid = expense.status !== "void" && !!expense.journalEntryId;

  return (
    <>
      {error && (
        <div className="fixed bottom-4 right-4 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg shadow-lg text-sm z-50">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Record Payment — only for unpaid posted expenses */}
        {isUnpaid && (
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
        {(canDelete || canVoid) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canVoid && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setShowVoidDialog(true)}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Void
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
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

      {/* Void Dialog */}
      <Dialog open={showVoidDialog} onOpenChange={setShowVoidDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Expense</DialogTitle>
            <DialogDescription>
              Reverses every journal entry {expense.expenseNumber} raised — the
              expense itself, and its payment clearing entry if it has one. The
              reversals are dated today and post into the current period; the
              original entries stay in the ledger, which is what an audit trail
              is for.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="voidReason">Reason</Label>
            <Input
              id="voidReason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Why is this being voided?"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowVoidDialog(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoid}
              disabled={loading || voidReason.trim().length < 3}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4 mr-2" />
              )}
              Void Expense
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

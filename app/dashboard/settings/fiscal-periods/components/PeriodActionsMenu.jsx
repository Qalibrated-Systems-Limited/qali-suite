"use client";

import { useState, useTransition } from "react";
import {
  MoreHorizontal,
  CalendarX,
  Lock,
  RefreshCw,
  Loader2,
  BarChart3,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
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
  closeFiscalPeriod,
  reopenFiscalPeriod,
  lockFiscalPeriod,
  calculatePeriodStatistics,
} from "@/app/mongodb/actions/fiscal-period-actions";

export default function PeriodActionsMenu({ period }) {
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const clearMessages = () => {
    setError("");
    setSuccess("");
  };

  const handleClose = () => {
    clearMessages();
    startTransition(async () => {
      const result = await closeFiscalPeriod(period._id);

      if (result.success) {
        setSuccess(`${period.periodName} has been closed.`);
        setTimeout(() => {
          setShowCloseConfirm(false);
          clearMessages();
        }, 1500);
      } else {
        setError(result.error);
      }
    });
  };

  const handleReopen = () => {
    if (!reason.trim()) {
      setError("Please provide a reason for reopening the period.");
      return;
    }

    clearMessages();
    startTransition(async () => {
      const result = await reopenFiscalPeriod(period._id, reason);

      if (result.success) {
        setSuccess(`${period.periodName} has been reopened.`);
        setTimeout(() => {
          setShowReopenDialog(false);
          setReason("");
          clearMessages();
        }, 1500);
      } else {
        setError(result.error);
      }
    });
  };

  const handleLock = () => {
    clearMessages();
    startTransition(async () => {
      const result = await lockFiscalPeriod(period._id, reason || "Period locked by administrator");

      if (result.success) {
        setSuccess(`${period.periodName} has been permanently locked.`);
        setTimeout(() => {
          setShowLockDialog(false);
          setReason("");
          clearMessages();
        }, 1500);
      } else {
        setError(result.error);
      }
    });
  };

  const handleCalculateStats = () => {
    clearMessages();
    startTransition(async () => {
      const result = await calculatePeriodStatistics(period._id);

      if (!result.success) {
        setError(result.error);
      }
    });
  };

  const MessageDisplay = () => (
    <>
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 text-sm mb-4">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 text-sm mb-4">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}
    </>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Open period actions */}
          {period.status === "open" && (
            <>
              <DropdownMenuItem onClick={() => setShowCloseConfirm(true)}>
                <CalendarX className="h-4 w-4 mr-2" />
                Close Period
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCalculateStats}>
                <BarChart3 className="h-4 w-4 mr-2" />
                Calculate Statistics
              </DropdownMenuItem>
            </>
          )}

          {/* Closed period actions */}
          {period.status === "closed" && (
            <>
              <DropdownMenuItem onClick={() => setShowReopenDialog(true)}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Reopen Period
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowLockDialog(true)}
                className="text-red-600"
              >
                <Lock className="h-4 w-4 mr-2" />
                Lock Period
              </DropdownMenuItem>
            </>
          )}

          {/* Locked period - no actions */}
          {period.status === "locked" && (
            <DropdownMenuItem disabled>
              <Lock className="h-4 w-4 mr-2" />
              Period is permanently locked
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Close Confirmation Dialog */}
      <Dialog open={showCloseConfirm} onOpenChange={(open) => { setShowCloseConfirm(open); if (!open) clearMessages(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Fiscal Period</DialogTitle>
            <DialogDescription>
              Are you sure you want to close {period.periodName}? This will:
            </DialogDescription>
          </DialogHeader>

          <MessageDisplay />

          <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 py-2">
            <li>Prevent new transactions from being posted to this period</li>
            <li>Create a closing journal entry transferring net income to Retained Earnings</li>
            <li>Calculate and store period statistics</li>
          </ul>
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Note: You can reopen a closed period if needed, but it requires administrator approval.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleClose} disabled={isPending || !!success}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Closing...
                </>
              ) : (
                <>
                  <CalendarX className="h-4 w-4 mr-2" />
                  Close Period
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen Dialog */}
      <Dialog open={showReopenDialog} onOpenChange={(open) => { setShowReopenDialog(open); if (!open) { clearMessages(); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen Fiscal Period</DialogTitle>
            <DialogDescription>
              Reopening {period.periodName} will allow new transactions to be
              posted. Please provide a reason for audit purposes.
            </DialogDescription>
          </DialogHeader>

          <MessageDisplay />

          <div className="space-y-2 py-4">
            <Label htmlFor="reopen-reason">Reason for Reopening *</Label>
            <Textarea
              id="reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Correction needed for missed invoice..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowReopenDialog(false);
                setReason("");
                clearMessages();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleReopen} disabled={isPending || !reason.trim() || !!success}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Reopening...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reopen Period
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lock Dialog */}
      <Dialog open={showLockDialog} onOpenChange={(open) => { setShowLockDialog(open); if (!open) { clearMessages(); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Lock Fiscal Period</DialogTitle>
            <DialogDescription>
              Locking {period.periodName} is permanent and cannot be undone.
              This should only be done after audit completion.
            </DialogDescription>
          </DialogHeader>

          <MessageDisplay />

          <div className="space-y-2 py-4">
            <Label htmlFor="lock-reason">Reason (Optional)</Label>
            <Textarea
              id="lock-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Post-audit lock, Year-end close..."
              rows={3}
            />
          </div>
          <div className="rounded-md bg-red-50 dark:bg-red-950 p-3 text-sm text-red-600 dark:text-red-400">
            Warning: This action is irreversible. The period will be permanently
            locked and no changes will be possible.
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowLockDialog(false);
                setReason("");
                clearMessages();
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleLock} disabled={isPending || !!success}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Locking...
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4 mr-2" />
                  Lock Period Permanently
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { approveExpense, rejectExpense } from "@/app/mongodb/actions/expense-actions";

export default function PendingExpenseActions({ expenseId }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const handleApprove = async () => {
    setLoading(true);
    try {
      const result = await approveExpense(expenseId);
      if (result.success) {
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("reason", rejectReason);
      const result = await rejectExpense(expenseId, {}, formData);
      if (result.success) {
        setShowRejectDialog(false);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowRejectDialog(true)}
          disabled={loading}
        >
          <XCircle className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Reject</span>
        </Button>
        <Button size="sm" onClick={handleApprove} disabled={loading}>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin sm:mr-2" />
          ) : (
            <CheckCircle2 className="w-4 h-4 sm:mr-2" />
          )}
          <span className="hidden sm:inline">Approve</span>
        </Button>
      </div>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Expense</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this expense.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Textarea
                id="reason"
                placeholder="Why is this expense being rejected?"
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
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

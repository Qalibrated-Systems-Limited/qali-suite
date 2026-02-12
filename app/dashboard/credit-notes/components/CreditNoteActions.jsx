"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  issueCreditNote,
  voidCreditNote,
  deleteDraftCreditNote,
} from "@/app/mongodb/actions/credit-note-actions";
import { toast } from "sonner";

export function CreditNoteActions({ creditNote, userRole }) {
  const router = useRouter();

  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleIssue = async () => {
    setLoading(true);
    try {
      const result = await issueCreditNote(creditNote._id);
      if (result.success) {
        toast.success("Credit note issued successfully");
        setIssueDialogOpen(false);
        router.refresh();
      } else {
        toast.error("Failed to issue credit note", {
          description: result.error,
        });
      }
    } catch (error) {
      toast.error("An error occurred", { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleVoid = async () => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("reason", voidReason);
      const result = await voidCreditNote(creditNote._id, null, formData);
      if (result.success) {
        toast.success("Credit note voided");
        setVoidDialogOpen(false);
        router.refresh();
      } else {
        toast.error("Failed to void credit note", {
          description: result.error,
        });
      }
    } catch (error) {
      toast.error("An error occurred", { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      const result = await deleteDraftCreditNote(creditNote._id);
      if (result.success) {
        toast.success("Credit note deleted");
        router.push("/dashboard/credit-notes");
      } else {
        toast.error("Failed to delete credit note", {
          description: result.error,
        });
      }
    } catch (error) {
      toast.error("An error occurred", { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const canIssue = creditNote.status === "draft";
  const canVoid =
    creditNote.status === "issued" &&
    creditNote.amountApplied === 0 &&
    userRole === "Admin";
  const canDelete = creditNote.status === "draft";

  return (
    <div className="space-y-2">
      {/* Issue Credit Note */}
      {canIssue && (
        <Button
          className="w-full bg-green-600 hover:bg-green-700"
          onClick={() => setIssueDialogOpen(true)}
          disabled={loading}
        >
          <CheckCircle className="mr-2 h-4 w-4" />
          Issue Credit Note
        </Button>
      )}

      {/* Void Credit Note */}
      {canVoid && (
        <Button
          variant="outline"
          className="w-full border-red-500/20 text-red-600 hover:bg-red-500/10"
          onClick={() => setVoidDialogOpen(true)}
          disabled={loading}
        >
          <XCircle className="mr-2 h-4 w-4" />
          Void Credit Note
        </Button>
      )}

      {/* Delete Draft */}
      {canDelete && (
        <Button
          variant="outline"
          className="w-full border-red-500/20 text-red-600 hover:bg-red-500/10"
          onClick={() => setDeleteDialogOpen(true)}
          disabled={loading}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Draft
        </Button>
      )}

      {/* Issue Confirmation Dialog */}
      <AlertDialog open={issueDialogOpen} onOpenChange={setIssueDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Issue Credit Note</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to issue credit note{" "}
              {creditNote.creditNoteNumber}? This will:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Create journal entries to credit the customer</li>
                <li>Reduce the balance on invoice {creditNote.invoice?.invoiceNumber}</li>
                {creditNote.items?.some((i) => i.restoreInventory) && (
                  <li>Restore inventory for returned items</li>
                )}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <Button
              onClick={handleIssue}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-4 w-4" />
              )}
              Issue Credit Note
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Void Confirmation Dialog */}
      <AlertDialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void Credit Note</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to void credit note{" "}
              {creditNote.creditNoteNumber}? This will reverse all journal
              entries and restore the original invoice balance.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="voidReason">Reason for voiding</Label>
            <Textarea
              id="voidReason"
              placeholder="Enter reason..."
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              rows={2}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <Button
              onClick={handleVoid}
              disabled={loading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" />
              )}
              Void Credit Note
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Draft</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this draft credit note? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <Button
              onClick={handleDelete}
              disabled={loading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

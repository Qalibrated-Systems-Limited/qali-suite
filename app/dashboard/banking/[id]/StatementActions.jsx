"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Trash2,
  Loader2,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  rerunAutoMatch,
  deleteBankStatement,
} from "@/app/mongodb/actions/bank-feed-actions";

// ============================================
// DELETE CONFIRMATION DIALOG
// ============================================
function DeleteConfirmDialog({ onConfirm, onCancel, loading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-background rounded-lg shadow-lg w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <h2 className="text-lg font-semibold">Delete Statement</h2>
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          Are you sure you want to delete this bank statement? This will remove
          all unallocated transactions. This action cannot be undone.
        </p>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================
export default function StatementActions({ statementId, status }) {
  const router = useRouter();
  const [autoMatching, setAutoMatching] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleAutoMatch = async () => {
    setAutoMatching(true);
    setError("");

    try {
      const result = await rerunAutoMatch(statementId);

      if (result.success) {
        router.refresh();
      } else {
        setError(result.error || "Failed to run auto-match");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setAutoMatching(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError("");

    try {
      const result = await deleteBankStatement(statementId);

      if (result.success) {
        router.push("/dashboard/banking");
      } else {
        setError(result.error || "Failed to delete statement");
        setShowDeleteConfirm(false);
      }
    } catch (err) {
      setError(err.message || "An error occurred");
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && (
        <div className="w-full text-sm text-red-500 mb-2">{error}</div>
      )}

      {/* Auto-Match Button */}
      {status !== "completed" && (
        <Button
          variant="outline"
          onClick={handleAutoMatch}
          disabled={autoMatching}
        >
          {autoMatching ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Matching...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Re-run Auto-Match
            </>
          )}
        </Button>
      )}

      {/* Delete Button */}
      <Button
        variant="outline"
        onClick={() => setShowDeleteConfirm(true)}
        className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
      >
        <Trash2 className="h-4 w-4 mr-2" />
        Delete
      </Button>

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <DeleteConfirmDialog
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          loading={deleting}
        />
      )}
    </div>
  );
}

"use client";

// Legacy component — the approval workflow has been removed.
// Expenses now auto-post on creation. Any old "pending" expenses
// in the database will show this message instead of approve/reject buttons.

export default function PendingExpenseActions() {
  return (
    <p className="text-xs text-muted-foreground italic">
      Approval workflow removed — expenses now auto-post.
    </p>
  );
}

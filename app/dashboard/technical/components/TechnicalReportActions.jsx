"use client";

import { useState, useTransition } from "react";
import { Loader2, Send, Check, ClipboardCheck, Undo2, Pencil, Trash2 } from "lucide-react";
import {
  submitWorkflowReport,
  reviewWorkflowReport,
  approveWorkflowReport,
  reopenWorkflowReport,
  deleteWorkflowReport,
} from "@/app/db/actions/workflow-report-actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import TechnicalReportForm from "./TechnicalReportForm";

/**
 * The workflow bar on a report. Buttons only ever offer the ONE legal next
 * step for the current state, split by authority: `canManage` drafts/edits and
 * submits; `canSignOff` reviews, approves and reopens.
 */
export default function TechnicalReportActions({
  report,
  project,
  authorName = "",
  canManage = false,
  canSignOff = false,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const { id, projectId, status } = report;

  const run = (fn, ...args) =>
    startTransition(async () => {
      const res = await fn(...args);
      if (res?.success) toast.success(res.message);
      else toast.error(res?.error || "Something went wrong");
    });

  function del() {
    if (!confirm("Delete this report? This cannot be undone.")) return;
    startTransition(async () => {
      const res = await deleteWorkflowReport(id, projectId);
      if (res?.success) {
        toast.success(res.message);
        router.push(`/dashboard/technical?project=${projectId}`);
      } else {
        toast.error(res?.error || "Failed to delete");
      }
    });
  }

  if (editing) {
    return (
      <TechnicalReportForm
        report={report}
        projects={project ? [project] : []}
        defaultAuthorName={authorName}
        onDone={() => setEditing(false)}
      />
    );
  }

  const canDraftEdit = canManage && status === "draft";
  const canSubmit = canManage && status === "draft";
  const canReview = canSignOff && status === "submitted";
  const canApprove = canSignOff && status === "reviewed";
  const canReopen = canSignOff && status !== "draft";
  const canDelete = canManage && status !== "approved";

  if (!canDraftEdit && !canSubmit && !canReview && !canApprove && !canReopen && !canDelete)
    return null;

  return (
    <div
      className="tech-panel"
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "12px 14px" }}
    >
      <span className="tech-muted" style={{ fontSize: 13, marginRight: 2 }}>
        Workflow:
      </span>

      {canDraftEdit && (
        <button className="tech-btn-ghost" onClick={() => setEditing(true)} disabled={isPending}>
          <Pencil size={14} />
          Edit
        </button>
      )}
      {canSubmit && (
        <button className="tech-btn-gold" onClick={() => run(submitWorkflowReport, id, projectId)} disabled={isPending}>
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Submit for review
        </button>
      )}
      {canReview && (
        <button className="tech-btn-ghost" onClick={() => run(reviewWorkflowReport, id, projectId)} disabled={isPending}>
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
          Supervisor sign-off
        </button>
      )}
      {canApprove && (
        <button
          className="tech-btn-gold"
          style={{ background: "var(--tech-green)", color: "#fff" }}
          onClick={() => run(approveWorkflowReport, id, projectId)}
          disabled={isPending}
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Manager approval
        </button>
      )}
      {canReopen && (
        <button className="tech-btn-ghost" onClick={() => run(reopenWorkflowReport, id, projectId)} disabled={isPending}>
          <Undo2 size={14} />
          Reopen
        </button>
      )}
      {canDelete && (
        <button
          className="tech-btn-ghost"
          style={{ marginLeft: "auto", color: "var(--tech-red)" }}
          onClick={del}
          disabled={isPending}
        >
          <Trash2 size={14} />
          Delete
        </button>
      )}
    </div>
  );
}

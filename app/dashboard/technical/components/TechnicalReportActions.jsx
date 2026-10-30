"use client";

import { useState, useTransition } from "react";
import { Loader2, Send, Check, ClipboardCheck, Undo2, Pencil, Trash2, UserCog } from "lucide-react";
import {
  submitWorkflowReport,
  reviewWorkflowReport,
  approveWorkflowReport,
  reopenWorkflowReport,
  deleteWorkflowReport,
  reassignWorkflowReport,
} from "@/app/db/actions/workflow-report-actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import TechnicalReportForm from "./TechnicalReportForm";

function PeopleDialog({ title, sub, fields, people, onCancel, onConfirm, pending }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, ""])));
  const ready = fields.every((f) => values[f.key]);
  return (
    <div className="tech-overlay" onClick={onCancel}>
      <div className="tech-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {sub && <p className="dsub">{sub}</p>}
        {fields.map((f) => (
          <div key={f.key} className="tech-field" style={{ marginTop: 12 }}>
            <label className="tech-label">{f.label}</label>
            <select
              className="tech-select"
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            >
              <option value="">Choose…</option>
              {people
                .filter((u) => !(f.exclude || []).includes(u.id))
                .filter((u) => fields.every((o) => o.key === f.key || values[o.key] !== u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.role}
                  </option>
                ))}
            </select>
          </div>
        ))}
        {people.length < fields.length + 1 && (
          <p className="tech-muted" style={{ fontSize: 12, marginTop: 10 }}>
            The sign-off group needs at least {fields.length} people other than you. Add them under Settings → Users.
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" className="tech-btn-ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="tech-btn-gold" disabled={!ready || pending} onClick={() => onConfirm(values)}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : null}
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The workflow bar on a report. Buttons only ever offer the ONE legal next
 * step for the current state, split by authority: `canManage` drafts/edits and
 * submits — naming the supervisor and the approving manager; the named person
 * signs their step; the sign-off group reopens and reassigns.
 */
export default function TechnicalReportActions({
  report,
  project,
  authorName = "",
  canManage = false,
  canSignOff = false,
  currentUserId = null,
  signoffUsers = [],
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState(null); // "submit" | "reassign" | null
  const { id, projectId, status } = report;

  const run = (fn, ...args) =>
    startTransition(async () => {
      const res = await fn(...args);
      if (res?.success) {
        toast.success(res.message);
        setDialog(null);
      } else toast.error(res?.error || "Something went wrong");
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
  // The named person signs their step; a report submitted before names were
  // given is open to the sign-off group, as it always was.
  const isMine = (assigned) => !assigned || assigned === currentUserId;
  const canReview = canSignOff && status === "submitted" && isMine(report.assignedReviewerId);
  const canApprove = canSignOff && status === "reviewed" && isMine(report.assignedApproverId);
  const canReassign = canSignOff && (status === "submitted" || status === "reviewed");
  const canReopen = canSignOff && status !== "draft";
  const canDelete = canManage && status !== "approved";

  if (!canDraftEdit && !canSubmit && !canReview && !canApprove && !canReassign && !canReopen && !canDelete)
    return null;

  const waitingOn =
    status === "submitted" ? report.assignedReviewerName : status === "reviewed" ? report.assignedApproverName : null;

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
        <button className="tech-btn-gold" onClick={() => setDialog("submit")} disabled={isPending}>
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
      {waitingOn && !canReview && !canApprove && (
        <span className="tech-muted" style={{ fontSize: 13 }}>
          Waiting for <strong>{waitingOn}</strong>
        </span>
      )}
      {canReassign && (
        <button className="tech-btn-ghost" onClick={() => setDialog("reassign")} disabled={isPending}>
          <UserCog size={14} />
          Reassign
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
      {dialog === "submit" && (
        <PeopleDialog
          title="Submit for review"
          sub="Name who signs this report off. The supervisor reviews it first, then the manager approves it — two different people, neither of them you."
          fields={[
            { key: "reviewerId", label: "Supervisor", exclude: [currentUserId] },
            { key: "approverId", label: "Approving manager", exclude: [currentUserId] },
          ]}
          people={signoffUsers}
          pending={isPending}
          onCancel={() => setDialog(null)}
          onConfirm={(v) => run(submitWorkflowReport, id, projectId, v)}
        />
      )}
      {dialog === "reassign" && (
        <PeopleDialog
          title={status === "submitted" ? "Reassign the supervisor sign-off" : "Reassign the manager approval"}
          sub={`Currently with ${waitingOn || "nobody named"}.`}
          fields={[
            {
              key: "userId",
              label: status === "submitted" ? "New supervisor" : "New approving manager",
              exclude: [
                report.submittedById,
                status === "submitted" ? report.assignedApproverId : report.reviewedById,
                status === "submitted" ? report.assignedReviewerId : report.assignedApproverId,
              ].filter(Boolean),
            },
          ]}
          people={signoffUsers}
          pending={isPending}
          onCancel={() => setDialog(null)}
          onConfirm={(v) => run(reassignWorkflowReport, id, projectId, v.userId)}
        />
      )}
    </div>
  );
}

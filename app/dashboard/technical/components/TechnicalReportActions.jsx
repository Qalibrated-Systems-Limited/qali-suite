"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  submitWorkflowReport,
  reviewWorkflowReport,
  approveWorkflowReport,
  reopenWorkflowReport,
  deleteWorkflowReport,
  reassignWorkflowReport,
  recallWorkflowReport,
} from "@/app/db/actions/workflow-report-actions";
import TechnicalReportForm from "./TechnicalReportForm";
import { GOLD, INK, MUTE, PASS, FAIL, WAIT } from "./ui";

/**
 * The review panels on a report, laid out as the Workflow Reports app lays
 * them out: an "Approval route" card listing who signs and where it stands,
 * then — for the person it is waiting on — a gold "Your review" card with a
 * comment box, Approve, and Return to author (which needs a comment).
 *
 * This module names two people where the app routes to one manager: the
 * supervisor signs off first, then the approving manager approves. Both are
 * chosen when the report is submitted.
 */

function PeopleDialog({ title, sub, fields, people, onCancel, onConfirm, pending }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, ""])));
  const ready = fields.every((f) => values[f.key]);
  return (
    <div
      role="dialog"
      aria-label={title}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(22,19,16,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onCancel}
    >
      <div className="card modal-card" style={{ maxWidth: 460, width: "100%", padding: 18, background: "#fff", borderColor: GOLD }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 900, textTransform: "uppercase", fontSize: 14, color: INK }}>{title}</div>
        {sub && (
          <p className="muted" style={{ fontSize: 13, margin: "6px 0 12px" }}>
            {sub}
          </p>
        )}
        {fields.map((f) => (
          <label key={f.key} className="field">
            <span className="label">{f.label}</span>
            <select className="input" value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
              <option value="">— select —</option>
              {people
                .filter((u) => !(f.exclude || []).includes(u.id))
                .filter((u) => fields.every((o) => o.key === f.key || values[o.key] !== u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.role}
                  </option>
                ))}
            </select>
          </label>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" className="btn" style={{ flex: 1 }} disabled={pending} onClick={onCancel}>
            ← Back
          </button>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={!ready || pending} onClick={() => onConfirm(values)}>
            {pending ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewerRow({ label, name, state }) {
  const chip =
    state === "current"
      ? { text: "Awaiting them", color: WAIT }
      : state === "done"
        ? { text: "Done", color: PASS }
        : { text: "Waiting", color: MUTE };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "6px 0", borderTop: "1px solid #e6e0d2" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", color: MUTE }}>{label}</div>
        <div style={{ fontSize: 14, color: INK, fontWeight: 700 }}>{name || "—"}</div>
      </div>
      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".03em", color: "#fff", background: chip.color, padding: "3px 8px", borderRadius: 999 }}>
        {chip.text}
      </span>
    </div>
  );
}

export default function TechnicalReportActions({
  report,
  project,
  authorName = "",
  canManage = false,
  canSignOff = false,
  canRecall = false,
  currentUserId = null,
  signoffUsers = [],
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState(null); // "submit" | "reassign" | null
  const [comment, setComment] = useState("");
  const [note, setNote] = useState("");
  const { id, projectId, status } = report;

  const run = (fn, ...args) =>
    startTransition(async () => {
      setNote("Saving…");
      const res = await fn(...args);
      if (res?.success) {
        toast.success(res.message);
        setNote("Done. Notification sent.");
        setDialog(null);
        setComment("");
        router.refresh();
      } else {
        toast.error(res?.error || "Something went wrong");
        setNote(res?.error || "Could not save.");
      }
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
      <div style={{ marginTop: 14 }}>
        <TechnicalReportForm
          report={report}
          projects={project ? [project] : []}
          defaultAuthorName={authorName}
          onDone={() => setEditing(false)}
        />
      </div>
    );
  }

  const pending = status === "submitted" || status === "reviewed";
  // The named person signs their step; a report submitted before names were
  // given is open to the sign-off group, as it always was.
  const isMine = (assigned) => !assigned || assigned === currentUserId;
  const actAs =
    canSignOff && status === "submitted" && isMine(report.assignedReviewerId)
      ? "supervisor"
      : canSignOff && status === "reviewed" && isMine(report.assignedApproverId)
        ? "manager"
        : null;

  const decide = (decision) => {
    if (decision === "reject") {
      if (!comment.trim()) return setNote("A comment is required to return it.");
      return run(reopenWorkflowReport, id, projectId, comment);
    }
    return run(actAs === "supervisor" ? reviewWorkflowReport : approveWorkflowReport, id, projectId);
  };

  return (
    <>
      {/* Draft — the author's controls. */}
      {status === "draft" && canManage && (
        <div className="card" style={{ borderColor: GOLD, background: "#fdf6e3", padding: 14, marginTop: 14 }}>
          <div style={{ fontWeight: 900, textTransform: "uppercase", fontSize: 13, color: INK }}>Draft</div>
          <div className="muted" style={{ margin: "4px 0 10px" }}>
            Check the sheet below, then submit it — you name the supervisor who signs it off and the manager who approves it.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={isPending} onClick={() => setDialog("submit")} style={{ flex: "1 1 180px" }}>
              Review &amp; submit
            </button>
            <button className="btn" disabled={isPending} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn" disabled={isPending} onClick={del} style={{ color: FAIL }}>
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Approval route — who signs, and where it stands. Shown to everyone. */}
      {pending && (
        <div className="card" style={{ padding: 14, marginTop: 14, background: "#f3eee2" }}>
          <div style={{ fontWeight: 900, textTransform: "uppercase", fontSize: 12, color: INK, letterSpacing: ".04em", marginBottom: 8 }}>
            Approval route
          </div>
          <ReviewerRow
            label="Supervisor sign-off"
            name={report.reviewedByName || report.assignedReviewerName || "Any of the sign-off group"}
            state={status === "submitted" ? "current" : "done"}
          />
          <ReviewerRow
            label="Manager approval"
            name={report.assignedApproverName || "Any of the sign-off group"}
            state={status === "reviewed" ? "current" : "waiting"}
          />
          {canRecall && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="btn"
                style={{ fontSize: 12, padding: "6px 10px" }}
                disabled={isPending}
                onClick={() => run(recallWorkflowReport, id, projectId)}
              >
                Recall to draft
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                Spotted a mistake? Take it back before the supervisor signs it.
              </span>
            </div>
          )}
          {canSignOff && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn" style={{ fontSize: 12, padding: "6px 10px" }} disabled={isPending} onClick={() => setDialog("reassign")}>
                Reassign
              </button>
            </div>
          )}
        </div>
      )}

      {/* Your review — only the person it is waiting on. */}
      {pending && actAs && (
        <div className="card" style={{ borderColor: GOLD, background: "#fdf6e3", padding: 14, marginTop: 10 }}>
          <div style={{ fontWeight: 900, textTransform: "uppercase", fontSize: 13, color: INK }}>Your review</div>
          <div className="muted" style={{ margin: "4px 0 10px" }}>
            {actAs === "supervisor"
              ? "Your sign-off is recorded with your name and the time, and the report goes on to the approving manager."
              : "Your decision is recorded with your name and the time. Approving closes the record."}
          </div>
          <input
            className="input"
            placeholder="Comment (required to return to author)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn"
              disabled={isPending}
              onClick={() => decide("approve")}
              style={{ flex: 1, background: PASS, color: "#fff", borderColor: PASS, fontWeight: 900, textTransform: "uppercase" }}
            >
              {actAs === "supervisor" ? "Sign off" : "Approve"}
            </button>
            <button
              className="btn"
              disabled={isPending || !comment.trim()}
              onClick={() => decide("reject")}
              style={{
                flex: 1,
                background: comment.trim() ? FAIL : "#d8b4ac",
                color: "#fff",
                borderColor: comment.trim() ? FAIL : "#d8b4ac",
                fontWeight: 900,
                textTransform: "uppercase",
              }}
            >
              Return to author
            </button>
          </div>
          {note && <div style={{ color: WAIT, fontWeight: 700, fontSize: 13, marginTop: 8 }}>{note}</div>}
        </div>
      )}
      {pending && !actAs && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8, fontStyle: "italic" }}>
          Only the {status === "submitted" ? "named supervisor" : "named approving manager"} above can act on this report now.
        </div>
      )}

      {/* Approved — reopening is the sign-off group's. */}
      {status === "approved" && canSignOff && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn" style={{ fontSize: 12, padding: "6px 10px" }} disabled={isPending} onClick={() => run(reopenWorkflowReport, id, projectId, "")}>
            Reopen for correction
          </button>
        </div>
      )}

      {dialog === "submit" && (
        <PeopleDialog
          title="Please re-read before sending"
          sub="Once sent, this goes to the supervisor you name for sign-off, then to the approving manager — two different people, neither of them you."
          fields={[
            { key: "reviewerId", label: "Supervisor (signs off first)", exclude: [currentUserId] },
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
          sub={`Currently with ${(status === "submitted" ? report.assignedReviewerName : report.assignedApproverName) || "nobody named"}.`}
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
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  assignTechnicalWork,
  startTechnicalWork,
  submitTechnicalWork,
  approveTechnicalWork,
  returnTechnicalWork,
  reopenTechnicalWork,
  cancelTechnicalWork,
} from "@/app/db/actions/technical-actions";

/**
 * The buttons a calibration job or an inspection offers the person looking at
 * it. Shown only when the server would allow them; the server checks again.
 *
 *   technician (assigned, or anyone if unassigned): Start, Record result & submit
 *   technical manager: Assign, Approve, Return (with a reason), Reopen, Cancel
 *
 * A manager never sees Approve on work they carried out themselves — another
 * manager signs it, as 17025 / 17020 expect.
 */

export const WORK_STATUS = [
  { v: "scheduled", label: "Scheduled", cls: "amber" },
  { v: "in_progress", label: "In progress", cls: "blue" },
  { v: "returned", label: "Returned", cls: "red" },
  { v: "submitted", label: "Awaiting approval", cls: "amber" },
  { v: "approved", label: "Approved", cls: "green" },
  { v: "completed", label: "Completed", cls: "green" },
  { v: "cancelled", label: "Cancelled", cls: "slate" },
];

export function StatusBadge({ status }) {
  const s = WORK_STATUS.find((x) => x.v === status) || WORK_STATUS[0];
  return <span className={`tech-b ${s.cls}`}>{s.label}</span>;
}

const OUTCOMES = {
  job: {
    field: "result",
    label: "Result",
    options: [
      { v: "passed", label: "Passed" },
      { v: "failed", label: "Failed" },
    ],
  },
  inspection: {
    field: "ruling",
    label: "Ruling",
    options: [
      { v: "pass", label: "Pass" },
      { v: "fail", label: "Fail" },
      { v: "quarantined", label: "Quarantined" },
    ],
  },
};

export default function WorkActions({ kind, item, me, team = [] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState(null); // 'submit' | 'return' | null

  if (!me) return null;
  const assignee = kind === "job" ? item.technicianId : item.inspectorId;
  const mine = assignee && assignee === me.userId;
  const status = item.status;
  const canWork = me.isTechnician && (me.isManager || !assignee || mine);
  const label = kind === "job" ? item.jobNumber : item.inspectionNumber;

  function run(fn, ...args) {
    startTransition(async () => {
      try {
        const res = await fn(...args);
        if (res?.success) {
          toast.success(res.message);
          setDialog(null);
          router.refresh();
        } else {
          toast.error(res?.error || "Something went wrong");
        }
      } catch {
        toast.error("Could not reach the server. Reload the page and try again.");
      }
    });
  }

  const open = ["scheduled", "in_progress", "returned"].includes(status);

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {me.isManager && !["approved", "cancelled"].includes(status) && (
        <select
          className="tech-rowbtn"
          aria-label={`Assign ${label}`}
          value={assignee || ""}
          disabled={pending}
          onChange={(e) => run(assignTechnicalWork, kind, item.id, e.target.value)}
        >
          <option value="">Unassigned</option>
          {team.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      {canWork && ["scheduled", "returned"].includes(status) && (
        <button className="tech-rowbtn" disabled={pending} onClick={() => run(startTechnicalWork, kind, item.id)}>
          Start
        </button>
      )}
      {canWork && open && (
        <button className="tech-rowbtn" disabled={pending} onClick={() => setDialog("submit")}>
          Record result &amp; submit
        </button>
      )}

      {me.isManager && status === "submitted" && assignee !== me.userId && (
        <>
          <button className="tech-rowbtn" disabled={pending} onClick={() => run(approveTechnicalWork, kind, item.id)}>
            Approve
          </button>
          <button className="tech-rowbtn" disabled={pending} onClick={() => setDialog("return")}>
            Return
          </button>
        </>
      )}
      {me.isManager && status === "submitted" && assignee === me.userId && (
        <span className="tech-muted" style={{ fontSize: 11 }}>Another manager approves your work</span>
      )}
      {me.isManager && status === "approved" && (
        <button
          className="tech-rowbtn"
          disabled={pending}
          onClick={() => confirm(`Reopen ${label}? It will need approving again.`) && run(reopenTechnicalWork, kind, item.id)}
        >
          Reopen
        </button>
      )}
      {me.isManager && !["approved", "cancelled"].includes(status) && (
        <button
          className="tech-rowbtn"
          disabled={pending}
          onClick={() => confirm(`Cancel ${label}?`) && run(cancelTechnicalWork, kind, item.id)}
        >
          Cancel
        </button>
      )}
      {pending && <Loader2 size={14} className="animate-spin" />}

      {dialog === "submit" && (
        <SubmitDialog
          kind={kind}
          item={item}
          pending={pending}
          onClose={() => setDialog(null)}
          onSubmit={(outcome) => run(submitTechnicalWork, kind, item.id, outcome)}
        />
      )}
      {dialog === "return" && (
        <ReturnDialog
          label={label}
          pending={pending}
          onClose={() => setDialog(null)}
          onSubmit={(comment) => run(returnTechnicalWork, kind, item.id, comment)}
        />
      )}
    </span>
  );
}

function SubmitDialog({ kind, item, pending, onClose, onSubmit }) {
  const o = OUTCOMES[kind];
  const current = item[o.field];
  const [value, setValue] = useState(o.options.some((x) => x.v === current) ? current : "");
  const [notes, setNotes] = useState(item.notes || "");
  return (
    <div className="tech-overlay" onClick={onClose}>
      <div className="tech-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Record result &amp; submit</h3>
        <p className="dsub">
          {kind === "job" ? item.jobNumber : item.inspectionNumber} — {item.clientName}. A technical
          manager approves it before the {kind === "job" ? "certificate" : "report"} is issued.
        </p>
        {item.returnComment ? (
          <div className="tech-alert" style={{ marginBottom: 12 }}>Returned: {item.returnComment}</div>
        ) : null}
        <div className="tech-field">
          <label className="tech-label">{o.label} *</label>
          <select className="tech-select" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Choose…</option>
            {o.options.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
          </select>
        </div>
        <div className="tech-field" style={{ marginTop: 12 }}>
          <label className="tech-label">Notes / findings</label>
          <textarea className="tech-textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" className="tech-btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
          <button
            type="button"
            className="tech-btn-gold"
            disabled={pending || !value}
            onClick={() => onSubmit({ [o.field]: value, notes })}
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : null} Submit for approval
          </button>
        </div>
      </div>
    </div>
  );
}

function ReturnDialog({ label, pending, onClose, onSubmit }) {
  const [comment, setComment] = useState("");
  return (
    <div className="tech-overlay" onClick={onClose}>
      <div className="tech-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Return {label}</h3>
        <p className="dsub">Say what needs fixing. The technician is notified and sees this note.</p>
        <textarea className="tech-textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" className="tech-btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
          <button
            type="button"
            className="tech-btn-gold"
            disabled={pending || !comment.trim()}
            onClick={() => onSubmit(comment)}
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : null} Return to technician
          </button>
        </div>
      </div>
    </div>
  );
}

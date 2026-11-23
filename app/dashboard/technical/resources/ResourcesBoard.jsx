"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import {
  requestResource,
  decideResourceRequest,
  cancelResourceRequest,
  checkResourceAvailability,
} from "@/app/db/actions/resource-actions";

const TYPE_LABEL = { technician: "Technician", vehicle: "Vehicle", equipment: "Equipment" };
const SOURCE_LABEL = {
  ticket: "Help desk ticket", project_task: "Project task", project: "Project", contract: "Contract",
  calibration_job: "Calibration job", inspection: "Inspection", other: "Other work",
};
const STATUS_CLS = { pending: "amber", approved: "green", rejected: "red", cancelled: "slate" };
const today = () => new Date().toISOString().slice(0, 10);

export default function ResourcesBoard({ me, requests, availability, options, prefill, openForm }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState(me.isManager ? "queue" : "mine");
  const [formOpen, setFormOpen] = useState(openForm);

  const queue = requests.filter((r) => r.status === "pending");
  const mine = requests.filter((r) => r.requestedById === me.userId);
  const shown = tab === "queue" ? queue : tab === "mine" ? mine : requests;

  function run(fn, ...args) {
    startTransition(async () => {
      try {
        const res = await fn(...args);
        if (res?.success) {
          toast.success(res.message);
          setFormOpen(false);
          router.refresh();
        } else toast.error(res?.error || "Something went wrong");
      } catch {
        toast.error("Could not reach the server. Reload the page and try again.");
      }
    });
  }

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 8, marginTop: 12 }}>
        <div>
          <p className="eyebrow">Technical</p>
          <h1 className="h1">Resources</h1>
          <p className="muted" style={{ margin: "4px 0 0", maxWidth: 720 }}>
            Technicians, vehicles and test equipment are requested for a piece of work and approved by the technical
            manager, who sees whether each is free. Approval assigns the technician to the ticket, job or project task.
          </p>
        </div>
        <button className="tech-btn-gold" onClick={() => setFormOpen(true)}>
          <Plus size={14} strokeWidth={3} /> Request a resource
        </button>
      </div>

      <div className="tech-tabs" style={{ marginTop: 14 }}>
        {me.isManager && (
          <button className={`tech-tab ${tab === "queue" ? "on" : ""}`} onClick={() => setTab("queue")}>
            Waiting for approval ({queue.length})
          </button>
        )}
        <button className={`tech-tab ${tab === "mine" ? "on" : ""}`} onClick={() => setTab("mine")}>
          My requests ({mine.length})
        </button>
        {me.isManager && (
          <button className={`tech-tab ${tab === "all" ? "on" : ""}`} onClick={() => setTab("all")}>
            All ({requests.length})
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="tech-empty2">
          {tab === "queue" ? "Nothing is waiting for approval." : "No requests yet."}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {shown.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              me={me}
              avail={availability[r.id]}
              pending={pending}
              onDecide={(decision, note) => run(decideResourceRequest, r.id, decision, note)}
              onCancel={() => confirm(`Cancel ${r.requestNumber}?`) && run(cancelResourceRequest, r.id)}
            />
          ))}
        </div>
      )}

      {formOpen && (
        <RequestForm
          options={options}
          prefill={prefill}
          pending={pending}
          onClose={() => setFormOpen(false)}
          onSubmit={(fd) => run(requestResource, null, fd)}
        />
      )}
    </>
  );
}

function RequestCard({ r, me, avail, pending, onDecide, onCancel }) {
  const [note, setNote] = useState("");
  const blocked = avail?.blockers?.length > 0;
  return (
    <div className="card" style={{ padding: 14, borderLeft: `4px solid var(--tech-${r.status === "pending" ? "amber" : r.status === "approved" ? "green" : "slate"}, #c9a227)` }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="mono" style={{ fontWeight: 700 }}>{r.requestNumber}</span>
            <span className={`tech-b ${STATUS_CLS[r.status] || "slate"}`}>{r.status}</span>
            <span className="tech-b blue">{TYPE_LABEL[r.resourceType]}</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{r.resourceName}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {SOURCE_LABEL[r.sourceType] || r.sourceType}
            {r.sourceRef ? ` ${r.sourceRef}` : ""}{r.sourceTitle ? ` — ${r.sourceTitle}` : ""}
          </div>
          <div style={{ fontSize: 13, marginTop: 2 }}>
            <b>{r.startDate}</b> to <b>{r.endDate}</b> · asked by {r.requestedByName}
          </div>
          {r.notes && <div style={{ fontSize: 13, marginTop: 4 }}>{r.notes}</div>}
          {r.status !== "pending" && r.decidedByName && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {r.status} by {r.decidedByName}{r.decisionNote ? ` — ${r.decisionNote}` : ""}
            </div>
          )}
        </div>

        {r.status === "pending" && (me.isManager || r.requestedById === me.userId) && (
          <div style={{ minWidth: 280, flex: "0 1 360px" }}>
            {me.isManager && avail && <AvailabilityPanel a={avail} />}
            {me.isManager && (
              <>
                <textarea
                  className="tech-textarea"
                  rows={2}
                  placeholder={blocked ? "Not free — a note is required to approve anyway" : "Note (required to reject)"}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ marginTop: 8 }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button className="tech-btn-gold" disabled={pending || (blocked && !note.trim())} onClick={() => onDecide("approved", note)}>
                    Approve
                  </button>
                  <button className="tech-btn-ghost" disabled={pending || !note.trim()} onClick={() => onDecide("rejected", note)}>
                    Reject
                  </button>
                  {pending && <Loader2 size={14} className="animate-spin" />}
                </div>
              </>
            )}
            {r.requestedById === me.userId && (
              <button className="tech-rowbtn" style={{ marginTop: 6 }} disabled={pending} onClick={onCancel}>
                Cancel request
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AvailabilityPanel({ a }) {
  const free = !a.blockers.length && !a.warnings.length;
  return (
    <div style={{ fontSize: 12.5, borderRadius: 8, padding: 10, background: a.blockers.length ? "rgba(185,28,28,.08)" : free ? "rgba(21,128,61,.08)" : "rgba(202,138,4,.10)" }}>
      <div style={{ fontWeight: 800, marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
        {a.blockers.length ? <AlertTriangle size={14} color="#b91c1c" /> : free ? <CheckCircle2 size={14} color="#15803d" /> : <Info size={14} color="#a16207" />}
        {a.blockers.length ? "Not free as asked" : free ? "Free for these dates" : "Free, with notes"}
        {a.openWork != null && <span className="muted" style={{ fontWeight: 400 }}>· {a.openWork} open item{a.openWork === 1 ? "" : "s"}</span>}
      </div>
      {[...a.blockers.map((t) => ["✕", t, "#b91c1c"]), ...a.warnings.map((t) => ["!", t, "#a16207"])].map(([m, t, c], i) => (
        <div key={i} style={{ color: c }}>{m} {t}</div>
      ))}
    </div>
  );
}

function RequestForm({ options, prefill, pending, onClose, onSubmit }) {
  const [type, setType] = useState(["technician", "vehicle", "equipment"].includes(prefill.resourceType) ? prefill.resourceType : "technician");
  const [resourceId, setResourceId] = useState("");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [avail, setAvail] = useState(null);
  const list = useMemo(
    () => (type === "technician" ? options.technicians.map((t) => ({ id: t.id, name: `${t.name}${t.title ? ` — ${t.title}` : ""}` })) : type === "vehicle" ? options.vehicles : options.equipment),
    [type, options],
  );

  useEffect(() => {
    let live = true;
    setAvail(null);
    if (!resourceId || !start || !end || end < start) return;
    checkResourceAvailability(type, resourceId, start, end).then((a) => live && setAvail(a)).catch(() => {});
    return () => { live = false; };
  }, [type, resourceId, start, end]);

  return (
    <div className="tech-overlay" onClick={onClose}>
      <div className="tech-dialog" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <h3>Request a resource</h3>
        <p className="dsub">The technical manager approves it after checking it is free.</p>
        <form action={(fd) => onSubmit(fd)}>
          <div className="tech-form-grid">
            <div className="tech-field">
              <label className="tech-label">What *</label>
              <select className="tech-select" name="resourceType" value={type} onChange={(e) => { setType(e.target.value); setResourceId(""); }}>
                <option value="technician">Technician</option>
                <option value="vehicle">Vehicle</option>
                <option value="equipment">Equipment</option>
              </select>
            </div>
            <div className="tech-field">
              <label className="tech-label">{TYPE_LABEL[type]} *</label>
              <select className="tech-select" name="resourceId" required value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
                <option value="">Choose…</option>
                {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
            <div className="tech-field">
              <label className="tech-label">From *</label>
              <input className="tech-input" type="date" name="startDate" required value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="tech-field">
              <label className="tech-label">To *</label>
              <input className="tech-input" type="date" name="endDate" required value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="tech-field">
              <label className="tech-label">For *</label>
              <select className="tech-select" name="sourceType" defaultValue={prefill.sourceType || "other"}>
                {Object.entries(SOURCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="tech-field">
              <label className="tech-label">Reference</label>
              <input className="tech-input" name="sourceRef" defaultValue={prefill.sourceRef} placeholder="TKT-00012, PRJ-0004, contract no." />
            </div>
          </div>
          <input type="hidden" name="sourceId" value={prefill.sourceId || ""} />
          <div className="tech-field" style={{ marginTop: 12 }}>
            <label className="tech-label">What it is for</label>
            <input className="tech-input" name="sourceTitle" defaultValue={prefill.sourceTitle} placeholder="e.g. Weighbridge repair at KPA berth 3" />
          </div>
          <div className="tech-field" style={{ marginTop: 12 }}>
            <label className="tech-label">Notes for the technical manager</label>
            <textarea className="tech-textarea" name="notes" rows={2} />
          </div>
          {avail && <div style={{ marginTop: 12 }}><AvailabilityPanel a={avail} /></div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button type="button" className="tech-btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
            <button type="submit" className="tech-btn-gold" disabled={pending}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : null} Send for approval
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

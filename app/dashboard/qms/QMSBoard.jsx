"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Page,
  SectionHeader,
  StatGrid,
  Stat,
  Tabs,
  DataTable,
  Badge,
  Btn,
  Input,
  Select,
  Modal,
  fmt,
} from "@/components/erp-ui";
import {
  raiseNc,
  setNcStatus,
  deleteNc,
  saveCapa,
  createAudit,
  updateAudit,
  deleteAudit,
  scheduleReview,
  updateReview,
  deleteReview,
} from "@/app/db/actions/qms-actions";

// ── vocab ─────────────────────────────────────────────────────────────────────
const NC_SOURCE = {
  internal_audit: "Internal Audit",
  external_audit: "External Audit",
  customer_complaint: "Customer Complaint",
  supplier: "Supplier",
  process: "Process",
  product: "Product",
  other: "Other",
};
const NC_CATEGORY = { process: "Process", product: "Product", system: "System", external: "External", other: "Other" };
const SEVERITY = { minor: { label: "Minor", variant: "blue" }, major: { label: "Major", variant: "amber" }, critical: { label: "Critical", variant: "red" } };
const NC_STATUS = {
  open: { label: "Open", variant: "amber" },
  capa_in_progress: { label: "CAPA in progress", variant: "blue" },
  effectiveness_check: { label: "Effectiveness check", variant: "purple" },
  closed: { label: "Closed", variant: "green" },
  cancelled: { label: "Cancelled", variant: "default" },
};
const CAPA_STATUS = {
  open: { label: "Open", variant: "amber" },
  in_progress: { label: "In progress", variant: "blue" },
  completed: { label: "Completed", variant: "purple" },
  verified: { label: "Verified", variant: "green" },
  cancelled: { label: "Cancelled", variant: "default" },
};
const AUDIT_STATUS = {
  planned: { label: "Planned", variant: "blue" },
  in_progress: { label: "In progress", variant: "amber" },
  closed: { label: "Closed", variant: "green" },
  cancelled: { label: "Cancelled", variant: "default" },
};
const MR_STATUS = { scheduled: { label: "Scheduled", variant: "blue" }, held: { label: "Held", variant: "green" }, cancelled: { label: "Cancelled", variant: "default" } };

function pill(map, k) {
  const c = map[k] || { label: k, variant: "default" };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}
function selBox(value, onChange, opts) {
  return (
    <select value={value} onChange={onChange} style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 12 }}>
      {Object.entries(opts).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
    </select>
  );
}

export default function QMSBoard({ ncs, audits, reviews, stats, users, canManage }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("ncs");
  const [modal, setModal] = useState(null); // "nc" | "audit" | "review"
  const [capaFor, setCapaFor] = useState(null); // nc row

  function refresh() {
    startTransition(() => router.refresh());
  }
  async function run(fn, ...args) {
    const res = await fn(...args);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    refresh();
  }

  const ncRows = ncs.map((nc) => [
    <span key="n" style={{ fontWeight: 600 }}>{nc.ncNumber}</span>,
    NC_SOURCE[nc.source] || nc.source,
    NC_CATEGORY[nc.category] || nc.category,
    <span key="t" title={nc.description}>{nc.title}</span>,
    nc.isoClause || "—",
    pill(SEVERITY, nc.severity),
    nc.capa ? (
      <button key="c" onClick={() => canManage && setCapaFor(nc)} style={{ background: "none", border: "none", padding: 0, cursor: canManage ? "pointer" : "default", color: "var(--foreground)" }}>
        <b style={{ color: "#0070C0" }}>{nc.capa.capaNumber}</b> {pill(CAPA_STATUS, nc.capa.status)}
      </button>
    ) : canManage ? (
      <Btn key="c" size="sm" variant="outline" onClick={() => setCapaFor(nc)}>+ CAPA</Btn>
    ) : "—",
    canManage ? selBox(nc.status, (e) => run(setNcStatus, nc._id, e.target.value), NC_STATUS) : pill(NC_STATUS, nc.status),
    canManage ? <Btn key="x" size="sm" variant="danger" onClick={() => confirm(`Delete ${nc.ncNumber}?`) && run(deleteNc, nc._id)}>✕</Btn> : "",
  ]);

  const auditRows = audits.map((a) => [
    <span key="n" style={{ fontWeight: 600 }}>{a.auditNumber}</span>,
    a.title,
    a.standard || "—",
    a.auditorName || "—",
    a.department || "—",
    fmt.date(a.plannedDate),
    a.findings || (a.findingsCount ? `${a.findingsCount} finding(s)` : "—"),
    canManage ? selBox(a.status, (e) => run(updateAudit, a._id, { status: e.target.value }), AUDIT_STATUS) : pill(AUDIT_STATUS, a.status),
    canManage ? <Btn key="x" size="sm" variant="danger" onClick={() => confirm(`Delete ${a.auditNumber}?`) && run(deleteAudit, a._id)}>✕</Btn> : "",
  ]);

  const reviewRows = reviews.map((r) => [
    <span key="n" style={{ fontWeight: 600 }}>{r.reviewNumber}</span>,
    fmt.date(r.reviewDate),
    r.chairedBy || "—",
    r.attendees || "—",
    canManage ? selBox(r.status, (e) => run(updateReview, r._id, { status: e.target.value }), MR_STATUS) : pill(MR_STATUS, r.status),
    r.decisions || (r.actionsCount ? `${r.actionsCount} actions` : "—"),
    canManage ? <Btn key="x" size="sm" variant="danger" onClick={() => confirm(`Delete ${r.reviewNumber}?`) && run(deleteReview, r._id)}>✕</Btn> : "",
  ]);

  const actionBtn = {
    ncs: canManage && <Btn variant="gold" onClick={() => setModal("nc")}>+ Raise NC</Btn>,
    audits: canManage && <Btn variant="gold" onClick={() => setModal("audit")}>+ Plan Audit</Btn>,
    reviews: canManage && <Btn variant="gold" onClick={() => setModal("review")}>+ Schedule Review</Btn>,
  }[tab];

  return (
    <Page>
      <SectionHeader title="Quality (QMS)" sub="Non-conformances, CAPA, audits & management review" action={actionBtn} />

      <StatGrid>
        <Stat label="Open NCs" value={stats.openNcs} variant={stats.openNcs ? "amber" : "green"} icon="🎯" />
        <Stat label="Overdue CAPA Actions" value={stats.overdueCapa} variant={stats.overdueCapa ? "red" : "green"} icon="⏰" />
        <Stat label="Awaiting Effectiveness Check" value={stats.awaitingEffectiveness} variant="blue" icon="🔬" />
        <Stat label="Audits Planned" value={stats.auditsPlanned} variant="green" icon="📋" />
      </StatGrid>

      <div style={{ margin: "18px 0" }}>
        <Tabs
          tabs={[{ id: "ncs", label: "Non-Conformances" }, { id: "audits", label: "Audits" }, { id: "reviews", label: "Management Review" }]}
          active={tab}
          setActive={setTab}
        />
      </div>

      {tab === "ncs" && (
        <DataTable headers={["NC No", "Source", "Category", "Title", "Clause", "Severity", "CAPA", "Status", ""]} rows={ncRows} empty="No non-conformances raised." />
      )}
      {tab === "audits" && (
        <DataTable headers={["Audit No", "Title", "Standard", "Auditor", "Dept", "Planned", "Findings", "Status", ""]} rows={auditRows} empty="No audits planned." />
      )}
      {tab === "reviews" && (
        <DataTable headers={["Review No", "Date", "Chaired By", "Attendees", "Status", "Decisions", ""]} rows={reviewRows} empty="No management reviews scheduled." />
      )}

      {modal === "nc" && <NcModal users={users} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === "audit" && <AuditModal users={users} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === "review" && <ReviewModal onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {capaFor && <CapaModal nc={capaFor} users={users} onClose={() => setCapaFor(null)} onDone={() => { setCapaFor(null); refresh(); }} />}
    </Page>
  );
}

function NcModal({ users, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ title: "", source: "internal_audit", category: "process", severity: "minor", isoClause: "", ownerUserId: "", dueDate: "", description: "" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.title.trim()) return toast.error("A title is required");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const who = users.find((u) => u.id === f.ownerUserId);
    if (who) fd.set("ownerName", who.name);
    const res = await raiseNc(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="Raise non-conformance" width={620} onClose={onClose}>
      <Input label="Title" value={f.title} onChange={set("title")} required placeholder="Short statement of the non-conformance" />
      <Input label="Description" value={f.description} onChange={set("description")} placeholder="What was found, where, and against what requirement" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select label="Source" value={f.source} onChange={set("source")} options={Object.entries(NC_SOURCE).map(([v, l]) => ({ value: v, label: l }))} />
        <Select label="Category" value={f.category} onChange={set("category")} options={Object.entries(NC_CATEGORY).map(([v, l]) => ({ value: v, label: l }))} />
        <Select label="Severity" value={f.severity} onChange={set("severity")} options={Object.entries(SEVERITY).map(([v, o]) => ({ value: v, label: o.label }))} />
        <Input label="ISO clause" value={f.isoClause} onChange={set("isoClause")} placeholder="e.g. 7.5" />
        <Select label="Owner" value={f.ownerUserId} onChange={set("ownerUserId")} options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        <Input label="Due date" type="date" value={f.dueDate} onChange={set("dueDate")} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Raising…" : "Raise NC"}</Btn>
      </div>
    </Modal>
  );
}

function CapaModal({ nc, users, onClose, onDone }) {
  const c = nc.capa || {};
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    type: c.type || "corrective",
    action: c.action || "",
    ownerUserId: "",
    ownerName: c.ownerName || "",
    dueDate: c.dueDate ? c.dueDate.slice(0, 10) : "",
    status: c.status || "open",
    effectivenessDue: c.effectivenessDue ? c.effectivenessDue.slice(0, 10) : "",
    effectivenessResult: c.effectiveness || "pending",
  });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    setBusy(true);
    const who = users.find((u) => u.id === f.ownerUserId);
    const res = await saveCapa({
      nonconformanceId: nc._id,
      capaId: nc.capa?.id || null,
      ...f,
      ownerName: who?.name || f.ownerName,
    });
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title={`CAPA for ${nc.ncNumber}`} width={620} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginBottom: 12 }}>
        {nc.title} · verifying an <b>effective</b> CAPA closes the NC.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select label="Type" value={f.type} onChange={set("type")} options={[{ value: "corrective", label: "Corrective" }, { value: "preventive", label: "Preventive" }]} />
        <Select label="Status" value={f.status} onChange={set("status")} options={Object.entries(CAPA_STATUS).filter(([v]) => v !== "cancelled").map(([v, o]) => ({ value: v, label: o.label }))} />
      </div>
      <Input label="Action" value={f.action} onChange={set("action")} placeholder="What will be done to correct and prevent recurrence" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select label="Owner" value={f.ownerUserId} onChange={set("ownerUserId")} options={[{ value: "", label: f.ownerName || "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        <Input label="Action due" type="date" value={f.dueDate} onChange={set("dueDate")} />
        <Input label="Effectiveness check due" type="date" value={f.effectivenessDue} onChange={set("effectivenessDue")} />
        <Select label="Effectiveness" value={f.effectivenessResult} onChange={set("effectivenessResult")} options={[{ value: "pending", label: "Pending" }, { value: "effective", label: "Effective" }, { value: "not_effective", label: "Not effective" }]} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save CAPA"}</Btn>
      </div>
    </Modal>
  );
}

function AuditModal({ users, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ title: "", standard: "ISO 9001", auditorUserId: "", department: "", plannedDate: "" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.title.trim()) return toast.error("A title is required");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const who = users.find((u) => u.id === f.auditorUserId);
    if (who) fd.set("auditorName", who.name);
    const res = await createAudit(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="Plan audit" width={560} onClose={onClose}>
      <Input label="Title" value={f.title} onChange={set("title")} required placeholder="Internal Audit — Technical" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select label="Standard" value={f.standard} onChange={set("standard")} options={["ISO 9001", "ISO 17025", "ISO 45001", "ISO 14001", "Other"].map((v) => ({ value: v, label: v }))} />
        <Input label="Department" value={f.department} onChange={set("department")} placeholder="e.g. Technical" />
        <Select label="Auditor" value={f.auditorUserId} onChange={set("auditorUserId")} options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        <Input label="Planned date" type="date" value={f.plannedDate} onChange={set("plannedDate")} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Plan audit"}</Btn>
      </div>
    </Modal>
  );
}

function ReviewModal({ onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ reviewDate: "", chairedBy: "", attendees: "" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const res = await scheduleReview(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="Schedule management review" width={520} onClose={onClose}>
      <Input label="Date" type="date" value={f.reviewDate} onChange={set("reviewDate")} />
      <Input label="Chaired by" value={f.chairedBy} onChange={set("chairedBy")} placeholder="Managing Director" />
      <Input label="Attendees" value={f.attendees} onChange={set("attendees")} placeholder="All HODs" />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Schedule"}</Btn>
      </div>
    </Modal>
  );
}

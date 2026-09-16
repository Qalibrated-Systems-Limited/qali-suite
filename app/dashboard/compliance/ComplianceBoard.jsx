"use client";

import { useMemo, useState, useTransition } from "react";
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
  Alert,
  fmt,
} from "@/components/erp-ui";
import {
  createCertificate,
  updateCertificate,
  deleteCertificate,
  createObligation,
  deleteObligation,
  createTask,
  setTaskStatus,
  deleteTask,
} from "@/app/db/actions/compliance-actions";

const FREQ = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  one_off: "One-off",
};
const TASK_STATUS = {
  open: { label: "Open", variant: "blue" },
  in_progress: { label: "In progress", variant: "amber" },
  done: { label: "Done", variant: "green" },
};

const DAY = 86_400_000;
const today = () => new Date(new Date().toDateString());

function daysLeft(expiry) {
  if (!expiry) return null;
  return Math.round((new Date(expiry).getTime() - today().getTime()) / DAY);
}
function certState(expiry) {
  const d = daysLeft(expiry);
  if (d === null) return { label: "No expiry", variant: "default" };
  if (d < 0) return { label: "Expired", variant: "red" };
  if (d <= 60) return { label: "Expiring", variant: "amber" };
  return { label: "Current", variant: "green" };
}
function taskOverdue(t) {
  return t.status !== "done" && t.dueDate && new Date(t.dueDate) < today();
}

export default function ComplianceBoard({ certificates, obligations, tasks, stats, users, canManage }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("certs");
  const [modal, setModal] = useState(null); // "cert" | "obligation" | "task"

  const expiredCerts = useMemo(() => certificates.filter((c) => certState(c.expiryDate).variant === "red"), [certificates]);

  function refresh() {
    startTransition(() => router.refresh());
  }
  async function run(fn, ...args) {
    const res = await fn(...args);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    refresh();
  }

  const certRows = certificates.map((c) => {
    const st = certState(c.expiryDate);
    const d = daysLeft(c.expiryDate);
    return [
      <div key="n">
        <div style={{ fontWeight: 600 }}>{c.name}</div>
        {c.reference ? <div style={{ fontSize: 11, color: "var(--muted-foreground, #6b7280)" }}>{c.reference}</div> : null}
      </div>,
      c.responsibleName || "—",
      fmt.date(c.expiryDate),
      d === null ? "—" : <span style={{ color: d < 0 ? "#DC2626" : d <= 60 ? "#B8600B" : "var(--foreground)" }}>{d} days</span>,
      <Badge key="s" variant={st.variant}>{st.label}</Badge>,
      canManage ? (
        <Btn key="d" size="sm" variant="danger" onClick={() => confirm(`Delete ${c.name}?`) && run(deleteCertificate, c._id)}>✕</Btn>
      ) : "",
    ];
  });

  const obligRows = obligations.map((o) => [
    <span key="n" style={{ fontWeight: 600 }}>{o.name}</span>,
    o.agency || "—",
    fmt.date(o.nextDue),
    FREQ[o.frequency] || o.frequency,
    o.penalty || "—",
    canManage ? (
      <Btn key="d" size="sm" variant="danger" onClick={() => confirm(`Delete ${o.name}?`) && run(deleteObligation, o._id)}>✕</Btn>
    ) : "",
  ]);

  const taskRows = tasks.map((t) => {
    const overdue = taskOverdue(t);
    const st = TASK_STATUS[t.status] || { label: t.status, variant: "default" };
    return [
      <span key="t" style={{ fontWeight: 600 }}>{t.title}</span>,
      t.assignedName || "—",
      <span key="d" style={{ color: overdue ? "#DC2626" : "var(--foreground)" }}>{fmt.date(t.dueDate)}</span>,
      overdue ? <Badge key="s" variant="red">Overdue</Badge> : <Badge key="s" variant={st.variant}>{st.label}</Badge>,
      canManage ? (
        <div key="a" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            value={t.status}
            onChange={(e) => run(setTaskStatus, t._id, e.target.value)}
            style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 12 }}
          >
            {Object.entries(TASK_STATUS).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
          </select>
          <Btn size="sm" variant="danger" onClick={() => confirm(`Delete this task?`) && run(deleteTask, t._id)}>✕</Btn>
        </div>
      ) : "",
    ];
  });

  const addBtn = canManage
    ? {
        certs: <Btn variant="gold" onClick={() => setModal("cert")}>+ Add Certificate</Btn>,
        obligations: <Btn variant="gold" onClick={() => setModal("obligation")}>+ Add Obligation</Btn>,
        tasks: <Btn variant="gold" onClick={() => setModal("task")}>+ Add Task</Btn>,
      }[tab]
    : null;

  return (
    <Page>
      <SectionHeader title="Compliance" sub="Certificates, statutory obligations & tasks" action={addBtn} />

      {expiredCerts.length > 0 && (
        <Alert type="error">
          {expiredCerts.length === 1
            ? `${expiredCerts[0].name} has expired — schedule its renewal.`
            : `${expiredCerts.length} certificates have expired — schedule their renewals.`}
        </Alert>
      )}

      <StatGrid>
        <Stat label="Certificates" value={stats.certificates} icon="✅" />
        <Stat label="Current" value={stats.current} variant="green" icon="🟢" />
        <Stat label="Expiring ≤60 Days" value={stats.expiring} variant={stats.expiring ? "amber" : "green"} icon="⏳" />
        <Stat label="Open Tasks" value={stats.openTasks} variant={stats.overdueTasks ? "red" : "blue"} icon="📝" />
      </StatGrid>

      <div style={{ margin: "18px 0" }}>
        <Tabs
          tabs={[
            { id: "certs", label: `Certificates (${certificates.length})` },
            { id: "obligations", label: `Statutory Obligations (${obligations.length})` },
            { id: "tasks", label: `Tasks (${tasks.length})` },
          ]}
          active={tab}
          setActive={setTab}
        />
      </div>

      {tab === "certs" && (
        <DataTable headers={["Certificate", "Responsible", "Expiry", "Days Left", "Status", ""]} rows={certRows} empty="No certificates yet." searchable />
      )}
      {tab === "obligations" && (
        <DataTable headers={["Obligation", "Agency", "Next Due", "Frequency", "Penalty", ""]} rows={obligRows} empty="No statutory obligations yet." />
      )}
      {tab === "tasks" && (
        <DataTable headers={["Task Title", "Assigned To", "Due Date", "Status", ""]} rows={taskRows} empty="No compliance tasks yet." />
      )}

      {modal === "cert" && <CertModal users={users} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === "obligation" && <ObligationModal onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === "task" && <TaskModal users={users} certificates={certificates} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </Page>
  );
}

function CertModal({ users, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", responsibleUserId: "", reference: "", issueDate: "", expiryDate: "", notes: "" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.name.trim()) return toast.error("A certificate name is required");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const who = users.find((u) => u.id === f.responsibleUserId);
    if (who) fd.set("responsibleName", who.name);
    const res = await createCertificate(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="New Certificate" width={600} onClose={onClose}>
      <Input label="Name" value={f.name} onChange={set("name")} required placeholder="e.g. KENAS Accreditation CL/059" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Reference / No." value={f.reference} onChange={set("reference")} placeholder="CL/059" />
        <Select label="Responsible" value={f.responsibleUserId} onChange={set("responsibleUserId")} options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        <Input label="Issued" type="date" value={f.issueDate} onChange={set("issueDate")} />
        <Input label="Expires" type="date" value={f.expiryDate} onChange={set("expiryDate")} />
      </div>
      <Input label="Notes" value={f.notes} onChange={set("notes")} placeholder="Optional" />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Add Certificate"}</Btn>
      </div>
    </Modal>
  );
}

function ObligationModal({ onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", agency: "", nextDue: "", frequency: "monthly", penalty: "" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.name.trim()) return toast.error("An obligation name is required");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const res = await createObligation(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="New Statutory Obligation" width={560} onClose={onClose}>
      <Input label="Obligation" value={f.name} onChange={set("name")} required placeholder="e.g. VAT Return" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Agency" value={f.agency} onChange={set("agency")} placeholder="KRA" />
        <Input label="Next due" type="date" value={f.nextDue} onChange={set("nextDue")} />
        <Select label="Frequency" value={f.frequency} onChange={set("frequency")} options={Object.entries(FREQ).map(([v, l]) => ({ value: v, label: l }))} />
        <Input label="Penalty" value={f.penalty} onChange={set("penalty")} placeholder="1.5% / month" />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Add Obligation"}</Btn>
      </div>
    </Modal>
  );
}

function TaskModal({ users, certificates, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ title: "", assignedUserId: "", dueDate: "", status: "open", certificateId: "" });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (!f.title.trim()) return toast.error("A task title is required");
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.set(k, v));
    const who = users.find((u) => u.id === f.assignedUserId);
    if (who) fd.set("assignedName", who.name);
    const res = await createTask(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onDone();
  }
  return (
    <Modal title="New Compliance Task" width={560} onClose={onClose}>
      <Input label="Title" value={f.title} onChange={set("title")} required placeholder="e.g. Renew NEMA licence" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select label="Assigned to" value={f.assignedUserId} onChange={set("assignedUserId")} options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        <Input label="Due date" type="date" value={f.dueDate} onChange={set("dueDate")} />
        <Select label="Status" value={f.status} onChange={set("status")} options={Object.entries(TASK_STATUS).map(([v, o]) => ({ value: v, label: o.label }))} />
        <Select label="Linked certificate" value={f.certificateId} onChange={set("certificateId")} options={[{ value: "", label: "None" }, ...certificates.map((c) => ({ value: c._id, label: c.name }))]} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Add Task"}</Btn>
      </div>
    </Modal>
  );
}

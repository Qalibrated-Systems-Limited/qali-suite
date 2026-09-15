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
  fmt,
} from "@/components/erp-ui";
import { createTask, setTaskStatus, deleteTask } from "@/app/db/actions/tasks-actions";

// ── vocab ─────────────────────────────────────────────────────────────────────
const PRIORITY = {
  low: { label: "Low", variant: "default" },
  medium: { label: "Medium", variant: "blue" },
  high: { label: "High", variant: "amber" },
  critical: { label: "Critical", variant: "red" },
};
const STATUS = {
  open: { label: "Open", variant: "blue" },
  in_progress: { label: "In progress", variant: "amber" },
  blocked: { label: "Blocked", variant: "red" },
  completed: { label: "Completed", variant: "green" },
  cancelled: { label: "Cancelled", variant: "default" },
};
const OPEN_STATES = ["open", "in_progress", "blocked"];
const NEXT_STATUS = ["open", "in_progress", "blocked", "completed", "cancelled"];

function pill(map, key) {
  const c = map[key] || { label: key, variant: "default" };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}
function isOverdue(t) {
  return OPEN_STATES.includes(t.status) && t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString());
}

const TABS = [
  { id: "open", label: "Open" },
  { id: "overdue", label: "Overdue" },
  { id: "done", label: "Completed" },
];

export default function TasksBoard({ tasks, stats, users, canManage }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("open");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    return tasks.filter((t) => {
      if (tab === "open") return OPEN_STATES.includes(t.status);
      if (tab === "overdue") return isOverdue(t);
      if (tab === "done") return t.status === "completed" || t.status === "cancelled";
      return true;
    });
  }, [tasks, tab]);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function changeStatus(id, status) {
    const res = await setTaskStatus(id, status);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    refresh();
  }
  async function remove(t) {
    if (!confirm(`Delete ${t.taskNumber}? This cannot be undone.`)) return;
    const res = await deleteTask(t._id);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    refresh();
  }

  const tableRows = rows.map((t) => [
    <div key="t">
      <div style={{ fontWeight: 600 }}>{t.title}</div>
      <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{t.taskNumber}</div>
    </div>,
    t.department || <span style={{ color: "var(--muted-foreground)" }}>—</span>,
    t.assigneeName || <span style={{ color: "var(--muted-foreground)" }}>Unassigned</span>,
    <span key="d" style={{ color: isOverdue(t) ? "#C00000" : "var(--foreground)" }}>
      {t.status === "completed" ? fmt.date(t.completedAt) : fmt.date(t.dueDate)}
    </span>,
    pill(PRIORITY, t.priority),
    pill(STATUS, t.status),
    canManage ? (
      <div key="a" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <select
          value={t.status}
          onChange={(e) => changeStatus(t._id, e.target.value)}
          style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 12 }}
        >
          {NEXT_STATUS.map((sName) => (
            <option key={sName} value={sName}>{STATUS[sName]?.label || sName}</option>
          ))}
        </select>
        <Btn size="sm" variant="danger" onClick={() => remove(t)}>✕</Btn>
      </div>
    ) : (
      <span key="a" style={{ color: "var(--muted-foreground)" }}>—</span>
    ),
  ]);

  const headers = ["Task", "Department", "Assigned To", tab === "done" ? "Completed / Due" : "Due Date", "Priority", "Status", ""];

  return (
    <Page>
      <SectionHeader
        title="Tasks"
        sub="Assignments across every department"
        action={canManage ? <Btn variant="gold" onClick={() => setCreating(true)}>+ New Task</Btn> : null}
      />

      <StatGrid>
        <Stat label="Total" value={stats.total} icon="☑️" />
        <Stat label="Overdue" value={stats.overdue} variant="red" icon="⏰" />
        <Stat label="Critical" value={stats.critical} variant="amber" icon="⚠️" />
        <Stat label="Completed" value={stats.completed} variant="green" icon="✅" />
      </StatGrid>

      <div style={{ margin: "18px 0" }}>
        <Tabs tabs={TABS} active={tab} setActive={setTab} />
      </div>

      <DataTable headers={headers} rows={tableRows} empty="No tasks here yet." />

      {creating && (
        <CreateModal
          users={users}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); refresh(); }}
        />
      )}
    </Page>
  );
}

function CreateModal({ users, onClose, onCreated }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    department: "",
    priority: "medium",
    assignedToUserId: "",
    dueDate: "",
  });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.title.trim()) return toast.error("A task needs a title");
    setBusy(true);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.set(k, v));
    // Snapshot the assignee's name so the list never needs the join.
    const who = users.find((u) => u.id === form.assignedToUserId);
    if (who) fd.set("assigneeName", who.name);
    const res = await createTask(null, fd);
    setBusy(false);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onCreated();
  }

  return (
    <Modal title="New task" width={560} onClose={onClose}>
      <Input label="Title" value={form.title} onChange={set("title")} required placeholder="What needs doing?" />
      <Input label="Description" value={form.description} onChange={set("description")} placeholder="Optional detail" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Input label="Department" value={form.department} onChange={set("department")} placeholder="e.g. Finance" />
        <Select
          label="Priority"
          value={form.priority}
          onChange={set("priority")}
          options={Object.entries(PRIORITY).map(([value, v]) => ({ value, label: v.label }))}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Select
          label="Assign to"
          value={form.assignedToUserId}
          onChange={set("assignedToUserId")}
          options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
        />
        <Input label="Due date" type="date" value={form.dueDate} onChange={set("dueDate")} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create task"}</Btn>
      </div>
    </Modal>
  );
}

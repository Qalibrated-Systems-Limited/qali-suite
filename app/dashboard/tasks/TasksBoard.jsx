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
import Link from "next/link";
import { createTask, setTaskStatus, deleteTask } from "@/app/db/actions/tasks-actions";
import { setTicketStatus } from "@/app/db/actions/helpdesk-actions";

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

/**
 * Where an assignment came from. Each source has its own colour so a mixed
 * list reads at a glance: what is a help desk call, what is project work.
 */
export const SOURCES = {
  task: { label: "Task", color: "#2563eb", bg: "rgba(37,99,235,.12)" },
  ticket: { label: "Help desk", color: "#c2410c", bg: "rgba(194,65,12,.12)" },
  project: { label: "Project", color: "#7c3aed", bg: "rgba(124,58,237,.12)" },
  calibration: { label: "Calibration", color: "#0f766e", bg: "rgba(15,118,110,.12)" },
  inspection: { label: "Inspection", color: "#0e7490", bg: "rgba(14,116,144,.12)" },
  report: { label: "Report", color: "#a16207", bg: "rgba(161,98,7,.14)" },
};
export function SourceBadge({ source }) {
  const s = SOURCES[source] || { label: source, color: "#475569", bg: "rgba(71,85,105,.12)" };
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, color: s.color, background: s.bg, border: `1px solid ${s.color}33`, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}
const TICKET_STATUS_FOR_ASSIGNEE = [
  { v: "assigned", label: "Assigned" },
  { v: "in_progress", label: "In progress" },
  { v: "pending", label: "Pending" },
  { v: "resolved", label: "Resolved" },
];
const STATUS_LABEL = {
  open: "Open", in_progress: "In progress", blocked: "Blocked", todo: "To do",
  new: "New", assigned: "Assigned", pending: "Pending", escalated: "Escalated", reopened: "Reopened",
  scheduled: "Scheduled", returned: "Returned", submitted: "Awaiting sign-off", reviewed: "Awaiting approval",
};

const TABS = [
  { id: "mine", label: "Assigned to me" },
  { id: "open", label: "Open" },
  { id: "overdue", label: "Overdue" },
  { id: "done", label: "Completed" },
];

export default function TasksBoard({ tasks, stats, users, canManage, assignments = [], currentUserId }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("mine");
  const [sourceFilter, setSourceFilter] = useState("");
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
    canManage || t.assignedToUserId === currentUserId ? (
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
        {canManage && <Btn size="sm" variant="danger" onClick={() => remove(t)}>✕</Btn>}
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
        action={canManage ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link href="/dashboard/tasks/report" style={{ fontSize: 13, fontWeight: 700 }}>Work report</Link>
            <Btn variant="gold" onClick={() => setCreating(true)}>+ New Task</Btn>
          </div>
        ) : null}
      />

      <StatGrid>
        <Stat label="Total" value={stats.total} icon="☑️" />
        <Stat label="Overdue" value={stats.overdue} variant="red" icon="⏰" />
        <Stat label="Critical" value={stats.critical} variant="amber" icon="⚠️" />
        <Stat label="Completed" value={stats.completed} variant="green" icon="✅" />
      </StatGrid>

      <div style={{ margin: "18px 0" }}>
        <Tabs
        tabs={TABS.map((t) => (t.id === "mine" ? { ...t, label: `Assigned to me (${assignments.length})` } : t))}
        active={tab}
        setActive={setTab}
      />
      </div>

      {tab === "mine" ? (
        <MyAssignments
          items={assignments}
          sourceFilter={sourceFilter}
          setSourceFilter={setSourceFilter}
          onChanged={refresh}
        />
      ) : (
        <DataTable headers={headers} rows={tableRows} empty="No tasks here yet." />
      )}

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

/**
 * Everything assigned to the viewer anywhere in the application, with the
 * source on each row. Tasks and help desk tickets can be moved along here;
 * the rest open where the work is done.
 */
function MyAssignments({ items, sourceFilter, setSourceFilter, onChanged }) {
  const counts = items.reduce((m, a) => ({ ...m, [a.source]: (m[a.source] || 0) + 1 }), {});
  const shown = sourceFilter ? items.filter((a) => a.source === sourceFilter) : items;
  const overdue = items.filter((a) => a.overdue).length;

  async function setStatus(a, status) {
    const res = a.source === "task" ? await setTaskStatus(a.id, status) : await setTicketStatus(a.id, status);
    if (res?.error) return toast.error(res.error);
    toast.success(res.message);
    onChanged();
  }

  const chip = (id, label, n) => (
    <button
      key={id || "all"}
      type="button"
      onClick={() => setSourceFilter(id)}
      style={{
        padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
        border: `1.5px solid ${sourceFilter === id ? "var(--foreground)" : "var(--border)"}`,
        background: sourceFilter === id ? "var(--foreground)" : "var(--background)",
        color: sourceFilter === id ? "var(--background)" : "var(--foreground)",
      }}
    >
      {label} {n != null ? `(${n})` : ""}
    </button>
  );

  return (
    <div>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted-foreground)" }}>
        Everything assigned to you across the application{overdue ? ` — ${overdue} overdue` : ""}. Work on tasks and
        help desk tickets here; the rest open where the work is done.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {chip("", "All", items.length)}
        {Object.keys(SOURCES).filter((k) => counts[k]).map((k) => chip(k, SOURCES[k].label, counts[k]))}
      </div>
      <DataTable
        headers={["Source", "Item", "Where", "Due", "Status", ""]}
        rows={shown.map((a) => [
          <SourceBadge key="s" source={a.source} />,
          <div key="i">
            <div style={{ fontWeight: 600 }}>{a.title}</div>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{a.ref}</div>
          </div>,
          <span key="w" style={{ fontSize: 12 }}>{a.detail || "—"}</span>,
          <span key="d" style={{ color: a.overdue ? "#C00000" : "var(--foreground)", fontWeight: a.overdue ? 700 : 400 }}>
            {a.dueDate ? fmt.date(a.dueDate) : "—"}{a.overdue ? " · overdue" : ""}
          </span>,
          a.source === "task" || a.source === "ticket" ? (
            <select
              key="st"
              value={a.status}
              onChange={(e) => setStatus(a, e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 12 }}
            >
              {(a.source === "task"
                ? NEXT_STATUS.map((v) => ({ v, label: STATUS[v]?.label || v }))
                : TICKET_STATUS_FOR_ASSIGNEE.some((x) => x.v === a.status)
                  ? TICKET_STATUS_FOR_ASSIGNEE
                  : [{ v: a.status, label: STATUS_LABEL[a.status] || a.status }, ...TICKET_STATUS_FOR_ASSIGNEE]
              ).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          ) : (
            <Badge key="st" variant={a.status === "returned" ? "red" : "blue"}>{STATUS_LABEL[a.status] || a.status}</Badge>
          ),
          <Link key="o" href={a.href} style={{ fontSize: 12, fontWeight: 700 }}>Open →</Link>,
        ])}
        empty={sourceFilter ? "Nothing from this source." : "Nothing is assigned to you right now."}
      />
    </div>
  );
}

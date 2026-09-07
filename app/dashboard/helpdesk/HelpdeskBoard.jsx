"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
  Alert,
  Input,
  Select,
  Modal,
  T,
  fmt,
} from "@/components/erp-ui";
import {
  createTicket,
  setTicketStatus,
  assignTicket,
  escalateTicket,
  addTicketComment,
  deleteTicket,
  getTicketDetail,
} from "@/app/db/actions/helpdesk-actions";

// ── vocab ─────────────────────────────────────────────────────────────────────
const PRIORITY = {
  low: { label: "Low", variant: "blue" },
  medium: { label: "Medium", variant: "navy" },
  high: { label: "High", variant: "amber" },
  critical: { label: "Critical", variant: "red" },
};
const STATUS = {
  new: { label: "New", variant: "blue" },
  assigned: { label: "Assigned", variant: "navy" },
  in_progress: { label: "In progress", variant: "amber" },
  pending: { label: "Pending", variant: "default" },
  escalated: { label: "Escalated", variant: "purple" },
  resolved: { label: "Resolved", variant: "green" },
  closed: { label: "Closed", variant: "default" },
  reopened: { label: "Reopened", variant: "amber" },
};
const SOURCES = ["manual", "system", "crm", "safety", "scheduled"];
const OPEN_STATES = ["new", "assigned", "in_progress", "pending", "escalated", "reopened"];
const STATUS_FLOW = ["new", "assigned", "in_progress", "pending", "escalated", "resolved", "closed", "reopened"];
const ESC_LEVELS = [
  { value: "Supervisor", label: "Supervisor" },
  { value: "DepartmentHead", label: "Department Head" },
  { value: "MD", label: "Managing Director" },
];

function pill(map, key) {
  const c = map[key] || { label: key, variant: "default" };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

// SLA colour for a ticket's resolution clock.
function slaState(t) {
  if (t.status === "resolved" || t.status === "closed") return { label: "Met", variant: "green" };
  if (!t.resolutionDueAt) return { label: "—", variant: "default" };
  const due = new Date(t.resolutionDueAt).getTime();
  const now = Date.now();
  if (due < now) return { label: "Breached", variant: "red" };
  if (due < now + 4 * 3600_000) return { label: "Due soon", variant: "amber" };
  return { label: "On track", variant: "green" };
}
function whenShort(d) {
  return d ? new Date(d).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

export default function HelpdeskBoard({ tickets = [], categories = [], stats, users = [], canManage }) {
  const router = useRouter();
  const [tab, setTab] = useState("overview");
  const [isPending, startTransition] = useTransition();

  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("");
  const [priorityF, setPriorityF] = useState("");

  function act(fn, ...args) {
    return new Promise((resolve) => {
      startTransition(async () => {
        const res = await fn(...args);
        if (res?.success) {
          toast.success(res.message);
          router.refresh();
        } else {
          toast.error(res?.error || "Something went wrong");
        }
        resolve(res);
      });
    });
  }

  const filtered = useMemo(() => {
    let l = tickets;
    if (statusF === "__open") l = l.filter((t) => OPEN_STATES.includes(t.status));
    else if (statusF) l = l.filter((t) => t.status === statusF);
    if (priorityF) l = l.filter((t) => t.priority === priorityF);
    if (q.trim()) {
      const s = q.toLowerCase();
      l = l.filter((t) =>
        [t.ticketNumber, t.title, t.customerName, t.requesterName, t.assigneeName, t.categoryName]
          .some((x) => String(x || "").toLowerCase().includes(s)),
      );
    }
    return l;
  }, [tickets, statusF, priorityF, q]);

  const rows = filtered.map((t) => {
    const sla = slaState(t);
    return [
      <button key="number" onClick={() => setDetailId(t.id)} style={{ background: "none", border: "none", color: T.blue, fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 13 }}>
        {t.ticketNumber}
      </button>,
      <span key="title" title={t.title}>{t.title.length > 46 ? t.title.slice(0, 44) + "…" : t.title}</span>,
      t.categoryName || "—",
      pill(PRIORITY, t.priority),
      pill(STATUS, t.status),
      t.assigneeName || <span key="assignee" style={{ color: T.mgrey }}>Unassigned</span>,
      <Badge key="sla" variant={sla.variant}>{sla.label}</Badge>,
      fmt.date(t.createdAt),
    ];
  });

  return (
    <Page>
      <SectionHeader
        title="Help Desk"
        sub="Log, triage, assign and resolve requests against SLA."
        action={canManage ? <Btn variant="gold" onClick={() => setShowNew(true)}>+ New Ticket</Btn> : null}
      />

      <Tabs
        tabs={[{ id: "overview", label: "Dashboard" }, { id: "tickets", label: `Tickets (${tickets.length})` }]}
        active={tab}
        setActive={setTab}
      />

      {tab === "overview" && <Overview stats={stats} tickets={tickets} onOpen={setDetailId} />}

      {tab === "tickets" && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14, alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 240px" }}>
              <Input label="Search" value={q} onChange={setQ} placeholder="Ticket #, title, client, assignee…" />
            </div>
            <div style={{ width: 170 }}>
              <Select label="Status" value={statusF} onChange={setStatusF} options={[{ value: "", label: "All statuses" }, { value: "__open", label: "Open only" }, ...STATUS_FLOW.map((s) => ({ value: s, label: STATUS[s].label }))]} />
            </div>
            <div style={{ width: 150 }}>
              <Select label="Priority" value={priorityF} onChange={setPriorityF} options={[{ value: "", label: "All priorities" }, ...Object.keys(PRIORITY).map((p) => ({ value: p, label: PRIORITY[p].label }))]} />
            </div>
          </div>
          <DataTable
            headers={["Ticket", "Title", "Category", "Priority", "Status", "Assignee", "SLA", "Raised"]}
            rows={rows}
            empty="No tickets match. Raise one with “+ New Ticket”."
          />
        </>
      )}

      {showNew && (
        <NewTicketModal
          categories={categories}
          users={users}
          isPending={isPending}
          onClose={() => setShowNew(false)}
          onCreated={async (fd) => {
            const res = await act(createTicket, null, fd);
            if (res?.success) setShowNew(false);
          }}
        />
      )}

      {detailId && (
        <TicketDetail
          id={detailId}
          users={users}
          canManage={canManage}
          isPending={isPending}
          act={act}
          onClose={() => setDetailId(null)}
        />
      )}
    </Page>
  );
}

// ── Dashboard tab ──────────────────────────────────────────────────────────────
function Overview({ stats, tickets, onOpen }) {
  const breachingList = tickets
    .filter((t) => OPEN_STATES.includes(t.status) && slaState(t).variant === "red")
    .slice(0, 6);
  const p = stats.byPriority;
  const maxP = Math.max(p.critical, p.high, p.medium, p.low, 1);

  return (
    <>
      {stats.breaching > 0 && (
        <Alert type="error">
          {stats.breaching} open ticket{stats.breaching === 1 ? " has" : "s have"} breached their resolution SLA.
        </Alert>
      )}
      {stats.breaching === 0 && stats.dueSoon > 0 && (
        <Alert type="warning">{stats.dueSoon} ticket{stats.dueSoon === 1 ? " is" : "s are"} approaching their SLA deadline.</Alert>
      )}
      {stats.open === 0 && <Alert type="success">No open tickets — the queue is clear.</Alert>}

      <StatGrid>
        <Stat label="Open Tickets" value={stats.open} icon="🎫" variant={stats.open ? "blue" : "green"} />
        <Stat label="Unassigned" value={stats.unassigned} icon="📥" variant={stats.unassigned ? "amber" : undefined} />
        <Stat label="Breaching SLA" value={stats.breaching} icon="⏰" variant={stats.breaching ? "red" : "green"} />
        <Stat label="Escalated" value={stats.escalated} icon="🚩" variant={stats.escalated ? "red" : undefined} />
        <Stat label="Resolved Today" value={stats.resolvedToday} icon="✅" variant="green" />
        <Stat label="Total (all time)" value={stats.total} icon="📊" />
      </StatGrid>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 12px", color: "var(--foreground)" }}>Open by priority</h3>
          {["critical", "high", "medium", "low"].map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
              <div style={{ width: 62 }}>{pill(PRIORITY, k)}</div>
              <div style={{ flex: 1, background: "var(--muted)", borderRadius: 99, height: 8, overflow: "hidden" }}>
                <div style={{ width: `${(p[k] / maxP) * 100}%`, height: "100%", background: PRIORITY[k].variant === "red" ? T.red : PRIORITY[k].variant === "amber" ? T.amber : PRIORITY[k].variant === "navy" ? T.navy : T.blue, borderRadius: 99 }} />
              </div>
              <span style={{ width: 26, textAlign: "right", fontWeight: 700, fontSize: 13, color: "var(--foreground)" }}>{p[k]}</span>
            </div>
          ))}
        </div>

        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 12px", color: "var(--foreground)" }}>Breaching now</h3>
          {breachingList.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Nothing breaching — every open ticket is within SLA.</p>
          ) : (
            breachingList.map((t) => (
              <div key={t.id} onClick={() => onOpen(t.id)} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                <span style={{ fontSize: 12.5, color: "var(--foreground)" }}>
                  <b style={{ color: T.blue }}>{t.ticketNumber}</b> · {t.title.slice(0, 30)}
                </span>
                <span style={{ flexShrink: 0 }}>{pill(PRIORITY, t.priority)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ── New ticket modal ─────────────────────────────────────────────────────────
function NewTicketModal({ categories, users, isPending, onClose, onCreated }) {
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignee, setAssignee] = useState("");

  // Default the priority to the chosen category's default.
  useEffect(() => {
    const c = categories.find((x) => x.id === categoryId);
    if (c) setPriority(c.defaultPriority);
  }, [categoryId, categories]);

  function submit(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("categoryId", categoryId);
    fd.set("priority", priority);
    fd.set("assignedToUserId", assignee);
    fd.set("assigneeName", users.find((u) => u.id === assignee)?.name || "");
    onCreated(fd);
  }

  return (
    <Modal title="New Ticket" onClose={onClose} width={620}>
      <form onSubmit={submit}>
        <Input label="Title" name="title" required placeholder="Short summary of the request" />
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", marginBottom: 5 }}>Description</label>
          <textarea name="description" rows={3} placeholder="What happened, where, and any detail that helps." style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13, color: "var(--foreground)", background: "var(--background)", boxSizing: "border-box", resize: "vertical" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Select label="Category" value={categoryId} onChange={setCategoryId} options={[{ value: "", label: "— Select —" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
          <Select label="Priority" value={priority} onChange={setPriority} options={Object.keys(PRIORITY).map((p) => ({ value: p, label: PRIORITY[p].label }))} />
          {/* Source is a native select so its value posts with the form. */}
          <SourceField />
          <Select label="Assign to" value={assignee} onChange={setAssignee} options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Input label="Client / company" name="customerName" placeholder="Who is this for" />
          <Input label="Requester" name="requesterName" placeholder="Person who raised it" />
          <Input label="Requester email" name="requesterEmail" type="email" placeholder="name@company.com" />
          <Input label="Due date" name="dueDate" type="date" />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
          <Btn variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Btn>
          <button type="submit" disabled={isPending} style={{ background: T.gold, color: "#fff", border: "none", padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: isPending ? "not-allowed" : "pointer" }}>
            {isPending ? "Raising…" : "Raise ticket"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// The erp-ui Select is controlled and doesn't post a form value, so the "Source"
// choice rides on a plain hidden-styled native select that DOES post.
function SourceField() {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", marginBottom: 5 }}>Source</label>
      <select name="source" defaultValue="manual" style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13, color: "var(--foreground)", background: "var(--background)", boxSizing: "border-box" }}>
        {SOURCES.map((sv) => <option key={sv} value={sv}>{sv[0].toUpperCase() + sv.slice(1)}</option>)}
      </select>
    </div>
  );
}

// ── Ticket detail modal ────────────────────────────────────────────────────────
function TicketDetail({ id, users, canManage, isPending, act, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [escLevel, setEscLevel] = useState("Supervisor");
  const [escReason, setEscReason] = useState("");
  const [resolveNotes, setResolveNotes] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const d = await getTicketDetail(id);
    setData(d);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function run(fn, ...args) {
    setBusy(true);
    const res = await act(fn, ...args);
    setBusy(false);
    if (res?.success) await load();
    return res;
  }

  const t = data?.ticket;
  const sla = t ? slaState(t) : null;

  return (
    <Modal title={t ? `${t.ticketNumber} · ${t.title}` : "Ticket"} onClose={onClose} width={860}>
      {loading || !t ? (
        <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Loading…</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
          {/* Left — description, thread, reply */}
          <div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {pill(STATUS, t.status)}
              {pill(PRIORITY, t.priority)}
              <Badge variant={sla.variant}>SLA: {sla.label}</Badge>
              {t.isEscalated && <Badge variant="purple">Escalated · {t.escalationLevel}</Badge>}
            </div>

            {t.description && (
              <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--foreground)", whiteSpace: "pre-wrap", marginTop: 0 }}>{t.description}</p>
            )}

            <h4 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted-foreground)", margin: "18px 0 8px" }}>Conversation</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto", paddingRight: 4 }}>
              {data.comments.length === 0 && <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>No messages yet.</p>}
              {data.comments.map((c) => (
                <div key={c.id} style={{ background: c.isInternal ? T.amberL : "var(--muted)", border: `1px solid ${c.isInternal ? "#FCD34D" : "var(--border)"}`, borderRadius: 8, padding: "8px 11px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted-foreground)", marginBottom: 3 }}>
                    <b style={{ color: "var(--foreground)" }}>{c.authorName}{c.isInternal ? " · internal note" : ""}</b>
                    <span>{whenShort(c.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--foreground)", whiteSpace: "pre-wrap" }}>{c.content}</div>
                </div>
              ))}
            </div>

            {canManage && (
              <div style={{ marginTop: 12 }}>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Write a reply or internal note…" style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13, color: "var(--foreground)", background: "var(--background)", boxSizing: "border-box", resize: "vertical" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <label style={{ fontSize: 12, color: "var(--foreground)", display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
                  </label>
                  <button disabled={busy || isPending || !reply.trim()} onClick={async () => { const r = await run(addTicketComment, id, reply, internal); if (r?.success) setReply(""); }} style={{ background: T.navy, color: "#fff", border: "none", padding: "7px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: busy || !reply.trim() ? 0.6 : 1 }}>
                    {internal ? "Add note" : "Post reply"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right — properties & actions */}
          <div style={{ borderLeft: "1px solid var(--border)", paddingLeft: 18 }}>
            <Meta label="Category" value={t.categoryName || "—"} />
            <Meta label="Client" value={t.customerName || "—"} />
            <Meta label="Requester" value={t.requesterName || "—"} />
            <Meta label="Assignee" value={t.assigneeName || "Unassigned"} />
            <Meta label="Raised" value={whenShort(t.createdAt)} />
            <Meta label="Response due" value={whenShort(t.responseDueAt)} />
            <Meta label="Resolution due" value={whenShort(t.resolutionDueAt)} />
            {t.firstResponseAt && <Meta label="First response" value={whenShort(t.firstResponseAt)} />}
            {t.resolvedAt && <Meta label="Resolved" value={whenShort(t.resolvedAt)} />}

            {canManage && (
              <>
                <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "14px 0" }} />
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", marginBottom: 5 }}>Status</label>
                <select value={t.status} disabled={busy} onChange={(e) => run(setTicketStatus, id, e.target.value)} style={selStyle}>
                  {STATUS_FLOW.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                </select>

                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", margin: "12px 0 5px" }}>Assign to</label>
                <select value={t.assignedToUserId || ""} disabled={busy} onChange={(e) => run(assignTicket, id, e.target.value || null, users.find((u) => u.id === e.target.value)?.name || "")} style={selStyle}>
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>

                {(t.status === "in_progress" || t.status === "pending" || t.status === "escalated" || t.status === "assigned") && (
                  <div style={{ marginTop: 14, background: T.greenL, borderRadius: 8, padding: 10 }}>
                    <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: T.green, marginBottom: 5 }}>Resolve</label>
                    <textarea value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} rows={2} placeholder="Resolution notes (what was done)" style={{ ...selStyle, resize: "vertical" }} />
                    <textarea value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={1} placeholder="Root cause" style={{ ...selStyle, marginTop: 6, resize: "vertical" }} />
                    <button disabled={busy} onClick={() => run(setTicketStatus, id, "resolved", { resolutionNotes: resolveNotes, rootCause })} style={{ marginTop: 6, width: "100%", background: T.green, color: "#fff", border: "none", padding: "7px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Mark resolved</button>
                  </div>
                )}

                {!t.isEscalated && OPEN_STATES.includes(t.status) && (
                  <div style={{ marginTop: 14, background: T.purpleL, borderRadius: 8, padding: 10 }}>
                    <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: T.purple, marginBottom: 5 }}>Escalate</label>
                    <select value={escLevel} onChange={(e) => setEscLevel(e.target.value)} style={selStyle}>
                      {ESC_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                    <input value={escReason} onChange={(e) => setEscReason(e.target.value)} placeholder="Reason" style={{ ...selStyle, marginTop: 6 }} />
                    <button disabled={busy} onClick={() => run(escalateTicket, id, escLevel, escReason)} style={{ marginTop: 6, width: "100%", background: T.purple, color: "#fff", border: "none", padding: "7px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Escalate</button>
                  </div>
                )}

                <button disabled={busy} onClick={async () => { if (confirm("Delete this ticket permanently?")) { const r = await act(deleteTicket, id); if (r?.success) onClose(); } }} style={{ marginTop: 16, width: "100%", background: "transparent", color: T.red, border: `1px solid ${T.red}`, padding: "7px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Delete ticket</button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

const selStyle = { width: "100%", padding: "8px 11px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13, color: "var(--foreground)", background: "var(--background)", boxSizing: "border-box" };

function Meta({ label, value }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted-foreground)" }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}>{value}</div>
    </div>
  );
}

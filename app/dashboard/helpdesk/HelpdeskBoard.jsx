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
  createCategory,
  setTicketTypeAction,
  mergeTicketAction,
  rateTicketAction,
  saveSlaPolicy,
  saveCannedResponse,
  deleteCannedResponseAction,
  saveArticleAction,
  markArticleHelpfulAction,
  linkSolutionArticleAction,
  setCategoryDefaultAssigneeAction,
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
export const TICKET_TYPES = {
  incident: "Incident",
  service_request: "Service request",
  question: "Question",
  problem: "Problem",
  complaint: "Complaint",
};
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
  if (t.status === "resolved" || t.status === "closed") {
    if (t.resolvedAt && t.resolutionDueAt && new Date(t.resolvedAt) > new Date(t.resolutionDueAt)) return { label: "Missed", variant: "red" };
    return { label: "Met", variant: "green" };
  }
  if (t.slaPausedAt) return { label: "Paused", variant: "default" };
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

export default function HelpdeskBoard({
  tickets = [], categories = [], stats, users = [], canManage, currentUserId = null, openTicketId = null, openNew = false,
  desk = canManage, canned = [], articles = [], sla = [],
}) {
  const router = useRouter();
  // The desk opens on its dashboard; everyone else on their own tickets.
  const [tab, setTab] = useState(desk ? "overview" : "tickets");
  const [isPending, startTransition] = useTransition();

  // Opened from New requisition (?new=1): start on the new-ticket form.
  const [showNew, setShowNew] = useState(openNew);
  // A link from Tasks or a notification (?ticket=…) opens that ticket.
  const [detailId, setDetailId] = useState(openTicketId);

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
      <span key="type" style={{ fontSize: 12 }}>{TICKET_TYPES[t.ticketType] || "Incident"}{t.categoryName ? ` · ${t.categoryName}` : ""}</span>,
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
        action={<Btn variant="gold" onClick={() => setShowNew(true)}>+ New Ticket</Btn>}
      />

      <Tabs
        tabs={[
          ...(desk ? [{ id: "overview", label: "Dashboard" }] : []),
          { id: "tickets", label: desk ? `Tickets (${tickets.length})` : `My tickets (${tickets.length})` },
          { id: "kb", label: `Knowledge base (${articles.length})` },
          ...(desk ? [{ id: "settings", label: "Settings" }] : []),
        ]}
        active={tab}
        setActive={setTab}
      />

      {tab === "overview" && desk && <Overview stats={stats} tickets={tickets} onOpen={setDetailId} />}
      {tab === "kb" && <KnowledgeBase articles={articles} categories={categories} desk={desk} act={act} />}
      {tab === "settings" && desk && (
        <DeskSettings sla={sla} canned={canned} categories={categories} users={users} act={act} />
      )}

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
            headers={["Ticket", "Title", "Type · category", "Priority", "Status", "Assignee", "SLA", "Raised"]}
            rows={rows}
            empty={desk ? "No tickets match. Raise one with “+ New Ticket”." : "You have not raised any tickets. Use “+ New Ticket” to ask for help."}
          />
        </>
      )}

      {showNew && (
        <NewTicketModal
          desk={desk}
          articles={articles}
          categories={categories}
          users={users}
          isPending={isPending}
          act={act}
          onClose={() => setShowNew(false)}
          onCreated={async (fd) => {
            const res = await act(createTicket, null, fd);
            if (res?.success) setShowNew(false);
          }}
        />
      )}

      {detailId && (
        <TicketDetail
          currentUserId={currentUserId}
          canned={canned}
          articles={articles}
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
function NewTicketModal({ desk, articles = [], categories, users, isPending, act, onClose, onCreated }) {
  const [titleText, setTitleText] = useState("");
  // Before raising, the articles that may already answer it.
  const suggestions = useMemo(() => {
    const words = titleText.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    if (!words.length) return [];
    return articles
      .map((a) => ({ a, hits: words.filter((w) => `${a.title} ${a.body}`.toLowerCase().includes(w)).length }))
      .filter((x) => x.hits > 0)
      .sort((x, y) => y.hits - x.hits)
      .slice(0, 3)
      .map((x) => x.a);
  }, [titleText, articles]);
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignee, setAssignee] = useState("");

  // Inline category creation, so triage isn't blocked by a missing category.
  const [addingCat, setAddingCat] = useState(false);
  const [catName, setCatName] = useState("");
  const [catDept, setCatDept] = useState("");
  const [catBusy, setCatBusy] = useState(false);

  // Default the priority to the chosen category's default.
  useEffect(() => {
    const c = categories.find((x) => x.id === categoryId);
    if (c) setPriority(c.defaultPriority);
  }, [categoryId, categories]);

  async function saveCategory() {
    if (!catName.trim()) return toast.error("Give the category a name");
    setCatBusy(true);
    const fd = new FormData();
    fd.set("name", catName.trim());
    fd.set("department", catDept.trim());
    fd.set("defaultPriority", priority);
    const res = await act(createCategory, null, fd);
    setCatBusy(false);
    if (res?.success) {
      toast.success("Category added");
      setCatName(""); setCatDept(""); setAddingCat(false);
      // router.refresh() (via act) re-fetches categories; the new one appears
      // in the dropdown on the next render.
    }
  }

  function submit(e) {
    e.preventDefault();
    if (!categoryId) return toast.error("Choose a category");
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
        <Input label="Title" name="title" required value={titleText} onChange={setTitleText} placeholder="Short summary of the request" />
        {suggestions.length > 0 && (
          <div style={{ background: T.blueL, border: "1px solid #BFDBFE", borderRadius: 8, padding: "8px 12px", margin: "-6px 0 12px", fontSize: 12.5 }}>
            <b>These articles may already answer it:</b>
            {suggestions.map((a) => (
              <div key={a.id}>• {a.title}</div>
            ))}
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", marginBottom: 5 }}>Description</label>
          <textarea name="description" rows={3} placeholder="What happened, where, and any detail that helps." style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13, color: "var(--foreground)", background: "var(--background)", boxSizing: "border-box", resize: "vertical" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <Select label="Category" value={categoryId} onChange={setCategoryId} options={[{ value: "", label: "— Select —" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
            {desk && (
              <button type="button" onClick={() => setAddingCat((v) => !v)} style={{ background: "none", border: "none", color: T.blue, fontSize: 11.5, fontWeight: 600, cursor: "pointer", padding: 0, marginTop: -8 }}>
                {addingCat ? "− Cancel new category" : "+ New category"}
              </button>
            )}
          </div>
          <Select label="Priority" value={priority} onChange={setPriority} options={Object.keys(PRIORITY).map((p) => ({ value: p, label: PRIORITY[p].label }))} />
          <TypeField />
          {desk && (
            <>
              {/* Source is a native select so its value posts with the form. */}
              <SourceField />
              <Select label="Assign to" value={assignee} onChange={setAssignee} options={[{ value: "", label: "Unassigned (or the category's default)" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
            </>
          )}
        </div>

        {addingCat && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end", background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <Input label="New category name" value={catName} onChange={setCatName} placeholder="e.g. Calibration Support" />
            <Input label="Department" value={catDept} onChange={setCatDept} placeholder="e.g. Technical" />
            <Btn variant="primary" size="sm" disabled={catBusy} onClick={saveCategory} style={{ marginBottom: 14 }}>{catBusy ? "Adding…" : "Add"}</Btn>
          </div>
        )}
        {desk ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Input label="Client / company" name="customerName" placeholder="Who is this for" />
            <Input label="Requester" name="requesterName" placeholder="Person who raised it" />
            <Input label="Requester email" name="requesterEmail" type="email" placeholder="name@company.com" />
            <Input label="Due date" name="dueDate" type="date" />
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "0 0 8px" }}>
            You will see replies under My tickets, and be notified when it is resolved.
          </p>
        )}
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

function TypeField() {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", marginBottom: 5 }}>Type</label>
      <select name="ticketType" defaultValue="incident" style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13, color: "var(--foreground)", background: "var(--background)", boxSizing: "border-box" }}>
        {Object.entries(TICKET_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
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
function TicketDetail({ id, users, canManage, currentUserId, canned = [], articles = [], isPending, act, onClose }) {
  const [mergeInto, setMergeInto] = useState("");
  const [stars, setStars] = useState(0);
  const [rateNote, setRateNote] = useState("");
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
  const isAssignee = Boolean(t && currentUserId && t.assignedToUserId === currentUserId);
  const isRequester = Boolean(data?.viewer?.requester);
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
              <Badge variant="blue">{TICKET_TYPES[t.ticketType] || "Incident"}</Badge>
              <Badge variant={sla.variant}>SLA: {sla.label}</Badge>
              {t.slaPausedAt && <Badge variant="default">Waiting on customer — clock paused</Badge>}
              {t.mergedIntoId && <Badge variant="default">Merged</Badge>}
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

            {(canManage || isAssignee || (isRequester && t.status !== "closed")) && (
              <div style={{ marginTop: 12 }}>
                {canManage && canned.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const c = canned.find((x) => x.id === e.target.value);
                      if (c) setReply((r) => (r ? `${r}\n\n${c.body}` : c.body));
                    }}
                    style={{ ...selStyle, marginBottom: 6 }}
                  >
                    <option value="">Insert a saved reply…</option>
                    {canned.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                )}
                {isRequester && !canManage && !isAssignee && t.status === "resolved" && (
                  <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 6px" }}>
                    Not fixed? Reply and the ticket reopens.
                  </p>
                )}
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Write a reply or internal note…" style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13, color: "var(--foreground)", background: "var(--background)", boxSizing: "border-box", resize: "vertical" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  {canManage || isAssignee ? (
                    <label style={{ fontSize: 12, color: "var(--foreground)", display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
                    </label>
                  ) : <span />}
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
            {canManage && !["resolved", "closed"].includes(t.status) && (
              <a
                href={`/dashboard/technical/resources?source=ticket&sourceId=${t.id}&ref=${encodeURIComponent(t.ticketNumber)}&title=${encodeURIComponent(t.title)}`}
                style={{ display: "inline-block", fontSize: 12, fontWeight: 700, margin: "2px 0 8px" }}
              >
                Request a technician, vehicle or equipment →
              </a>
            )}
            <Meta label="Raised" value={whenShort(t.createdAt)} />
            <Meta label="Response due" value={whenShort(t.responseDueAt)} />
            <Meta label="Resolution due" value={whenShort(t.resolutionDueAt)} />
            {t.firstResponseAt && <Meta label="First response" value={whenShort(t.firstResponseAt)} />}
            {t.resolvedAt && <Meta label="Resolved" value={whenShort(t.resolvedAt)} />}
            {t.satisfactionRating ? (
              <Meta label="Satisfaction" value={`${"★".repeat(t.satisfactionRating)}${"☆".repeat(5 - t.satisfactionRating)}${t.satisfactionComment ? ` — ${t.satisfactionComment}` : ""}`} />
            ) : null}
            {t.solutionArticleId && (
              <Meta label="Solved with" value={articles.find((a) => a.id === t.solutionArticleId)?.title || "Knowledge base article"} />
            )}

            {/* The requester rates a resolved ticket once. */}
            {isRequester && ["resolved", "closed"].includes(t.status) && !t.satisfactionRating && (
              <div style={{ marginTop: 14, background: T.amberL, borderRadius: 8, padding: 10 }}>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, marginBottom: 5 }}>How did we do?</label>
                <div style={{ fontSize: 22, letterSpacing: 2 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setStars(n)} style={{ background: "none", border: "none", cursor: "pointer", color: n <= stars ? "#d97706" : "#cbd5e1", fontSize: 22, padding: 0 }}>★</button>
                  ))}
                </div>
                <input value={rateNote} onChange={(e) => setRateNote(e.target.value)} placeholder="Anything to add? (optional)" style={{ ...selStyle, marginTop: 6 }} />
                <button disabled={busy || !stars} onClick={() => run(rateTicketAction, id, stars, rateNote)} style={{ marginTop: 6, width: "100%", background: T.gold, color: "#fff", border: "none", padding: "7px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: stars ? 1 : 0.6 }}>Send rating</button>
              </div>
            )}

            {(canManage || isAssignee) && articles.length > 0 && !["closed"].includes(t.status) && (
              <>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", margin: "12px 0 5px" }}>Solution article</label>
                <select value={t.solutionArticleId || ""} disabled={busy} onChange={(e) => run(linkSolutionArticleAction, id, e.target.value || null)} style={selStyle}>
                  <option value="">None</option>
                  {articles.filter((a) => a.status === "published").map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </>
            )}

            {!canManage && isAssignee && (
              <>
                <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "14px 0" }} />
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", marginBottom: 5 }}>Status — this ticket is yours</label>
                <select value={t.status} disabled={busy} onChange={(e) => run(setTicketStatus, id, e.target.value)} style={selStyle}>
                  {[...new Set([t.status, "assigned", "in_progress", "pending"])].map((s) => <option key={s} value={s}>{STATUS[s]?.label || s}</option>)}
                </select>
                {OPEN_STATES.includes(t.status) && (
                  <div style={{ marginTop: 14, background: T.greenL, borderRadius: 8, padding: 10 }}>
                    <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: T.green, marginBottom: 5 }}>Resolve</label>
                    <textarea value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} rows={2} placeholder="Resolution notes (what was done)" style={{ ...selStyle, resize: "vertical" }} />
                    <textarea value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={1} placeholder="Root cause" style={{ ...selStyle, marginTop: 6, resize: "vertical" }} />
                    <button disabled={busy} onClick={() => run(setTicketStatus, id, "resolved", { resolutionNotes: resolveNotes, rootCause })} style={{ marginTop: 6, width: "100%", background: T.greenSolid, color: "#fff", border: "none", padding: "7px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Mark resolved</button>
                  </div>
                )}
              </>
            )}

            {canManage && (
              <>
                <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "14px 0" }} />
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", marginBottom: 5 }}>Status</label>
                <select value={t.status} disabled={busy} onChange={(e) => run(setTicketStatus, id, e.target.value)} style={selStyle}>
                  {STATUS_FLOW.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                </select>

                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", margin: "12px 0 5px" }}>Type</label>
                <select value={t.ticketType || "incident"} disabled={busy} onChange={(e) => run(setTicketTypeAction, id, e.target.value)} style={selStyle}>
                  {Object.entries(TICKET_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
                    <button disabled={busy} onClick={() => run(setTicketStatus, id, "resolved", { resolutionNotes: resolveNotes, rootCause })} style={{ marginTop: 6, width: "100%", background: T.greenSolid, color: "#fff", border: "none", padding: "7px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Mark resolved</button>
                  </div>
                )}

                {!t.isEscalated && OPEN_STATES.includes(t.status) && (
                  <div style={{ marginTop: 14, background: T.purpleL, borderRadius: 8, padding: 10 }}>
                    <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: T.purple, marginBottom: 5 }}>Escalate</label>
                    <select value={escLevel} onChange={(e) => setEscLevel(e.target.value)} style={selStyle}>
                      {ESC_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                    <input value={escReason} onChange={(e) => setEscReason(e.target.value)} placeholder="Reason" style={{ ...selStyle, marginTop: 6 }} />
                    <button disabled={busy} onClick={() => run(escalateTicket, id, escLevel, escReason)} style={{ marginTop: 6, width: "100%", background: T.purpleSolid, color: "#fff", border: "none", padding: "7px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Escalate</button>
                  </div>
                )}

                {!t.mergedIntoId && t.status !== "closed" && (
                  <div style={{ marginTop: 14, background: "var(--muted)", borderRadius: 8, padding: 10 }}>
                    <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, marginBottom: 5 }}>Duplicate? Merge into</label>
                    <input value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} placeholder="Ticket number, e.g. TKT-00012" style={selStyle} />
                    <button disabled={busy || !mergeInto.trim()} onClick={async () => { if (confirm(`Close ${t.ticketNumber} as a duplicate of ${mergeInto}?`)) { const r = await run(mergeTicketAction, id, mergeInto); if (r?.success) onClose(); } }} style={{ marginTop: 6, width: "100%", background: T.navy, color: "#fff", border: "none", padding: "7px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: mergeInto.trim() ? 1 : 0.6 }}>Merge</button>
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

// ── Knowledge base ─────────────────────────────────────────────────────────────
// Answers written once and found before a ticket is raised. Everyone reads the
// published ones; the desk writes, drafts and archives them.
function KnowledgeBase({ articles, categories, desk, act }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null); // {} new | article
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? articles.filter((a) => `${a.title} ${a.body}`.toLowerCase().includes(s)) : articles;
  }, [articles, q]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ flex: "1 1 280px" }}>
          <Input label="Search the knowledge base" value={q} onChange={setQ} placeholder="e.g. printer, password, calibration certificate" />
        </div>
        {desk && <Btn variant="gold" onClick={() => setEditing({})}>+ New article</Btn>}
      </div>
      {shown.length === 0 ? (
        <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>
          {articles.length ? "No article matches." : desk ? "No articles yet. Write the answers you give most often." : "No articles yet."}
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {shown.map((a) => (
            <div key={a.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", background: "var(--card)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <button onClick={() => setOpen(open === a.id ? null : a.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontWeight: 700, fontSize: 14, color: "var(--foreground)" }}>
                  {a.title}
                </button>
                <span style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "var(--muted-foreground)" }}>
                  {a.status !== "published" && <Badge variant="amber">{a.status}</Badge>}
                  {a.articleNumber} · {a.views} views · {a.helpful} helpful
                  {desk && <Btn size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Btn>}
                </span>
              </div>
              {open === a.id && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.55 }}>{a.body}</div>
                  <Btn size="sm" variant="ghost" onClick={() => act(markArticleHelpfulAction, a.id)} style={{ marginTop: 8 }}>👍 This helped</Btn>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && <ArticleEditor article={editing} categories={categories} act={act} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ArticleEditor({ article, categories, act, onClose }) {
  const [title, setTitle] = useState(article.title || "");
  const [body, setBody] = useState(article.body || "");
  const [categoryId, setCategoryId] = useState(article.categoryId || "");
  const [status, setStatus] = useState(article.status || "published");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await act(saveArticleAction, { id: article.id, title, body, categoryId, status });
    setBusy(false);
    if (r?.success) onClose();
  }
  return (
    <Modal title={article.id ? `Edit ${article.articleNumber}` : "New article"} onClose={onClose} width={720}>
      <Input label="Title" value={title} onChange={setTitle} placeholder="The question as people ask it" />
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Answer</label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} style={{ ...selStyle, resize: "vertical" }} placeholder="Steps, in order. What to check first. When to raise a ticket instead." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
        <Select label="Category" value={categoryId} onChange={setCategoryId} options={[{ value: "", label: "— None —" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
        <Select label="Status" value={status} onChange={setStatus} options={[{ value: "published", label: "Published" }, { value: "draft", label: "Draft" }, { value: "archived", label: "Archived" }]} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" disabled={busy || !title.trim() || !body.trim()} onClick={save}>{busy ? "Saving…" : "Save article"}</Btn>
      </div>
    </Modal>
  );
}

// ── Desk settings ─────────────────────────────────────────────────────────────
// What the desk tunes: the SLA per priority, saved replies, and where each
// category's new tickets land.
function DeskSettings({ sla, canned, categories, users, act }) {
  const [rows, setRows] = useState(sla);
  const [cTitle, setCTitle] = useState("");
  const [cBody, setCBody] = useState("");
  useEffect(() => setRows(sla), [sla]);
  const set = (p, k, v) => setRows((rs) => rs.map((r) => (r.priority === p ? { ...r, [k]: v } : r)));

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <section>
        <h3 style={{ fontSize: 14, fontWeight: 800, margin: "0 0 4px" }}>Service levels</h3>
        <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "0 0 10px" }}>
          Hours to first response and to resolution, by priority. New tickets take these; the clock pauses while a ticket is Pending (waiting on the customer).
        </p>
        <DataTable
          headers={["Priority", "First response (h)", "Resolution (h)", ""]}
          rows={rows.map((r) => [
            <span key="p">{PRIORITY[r.priority]?.label || r.priority}{r.custom ? "" : " · default"}</span>,
            <input key="a" type="number" min="0.25" step="0.25" value={r.responseHours} onChange={(e) => set(r.priority, "responseHours", e.target.value)} style={{ ...selStyle, width: 110 }} />,
            <input key="b" type="number" min="0.25" step="0.25" value={r.resolutionHours} onChange={(e) => set(r.priority, "resolutionHours", e.target.value)} style={{ ...selStyle, width: 110 }} />,
            <Btn key="s" size="sm" variant="primary" onClick={() => act(saveSlaPolicy, r.priority, Number(r.responseHours), Number(r.resolutionHours))}>Save</Btn>,
          ])}
        />
      </section>

      <section>
        <h3 style={{ fontSize: 14, fontWeight: 800, margin: "0 0 4px" }}>Saved replies</h3>
        <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "0 0 10px" }}>Inserted into a reply from the ticket, then edited before sending.</p>
        <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          {canned.length === 0 && <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>None yet.</span>}
          {canned.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
              <div><b style={{ fontSize: 13 }}>{c.title}</b><div style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "pre-wrap" }}>{c.body.slice(0, 180)}{c.body.length > 180 ? "…" : ""}</div></div>
              <Btn size="sm" variant="danger" onClick={() => confirm(`Remove "${c.title}"?`) && act(deleteCannedResponseAction, c.id)}>✕</Btn>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, alignItems: "end" }}>
          <Input label="Title" value={cTitle} onChange={setCTitle} placeholder="e.g. Waiting for site access" />
          <Input label="Reply" value={cBody} onChange={setCBody} placeholder="Text inserted into the reply" />
          <Btn variant="gold" disabled={!cTitle.trim() || !cBody.trim()} onClick={async () => { const r = await act(saveCannedResponse, cTitle, cBody); if (r?.success) { setCTitle(""); setCBody(""); } }} style={{ marginBottom: 14 }}>Add</Btn>
        </div>
      </section>

      <section>
        <h3 style={{ fontSize: 14, fontWeight: 800, margin: "0 0 4px" }}>Where new tickets land</h3>
        <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "0 0 10px" }}>
          A new ticket in a category goes to its default assignee when nobody is named. A Technical-department technician is requested from the technical manager first.
        </p>
        <DataTable
          headers={["Category", "Department", "Default assignee"]}
          rows={categories.map((c) => [
            c.name,
            c.department || "—",
            <select key="a" value={c.defaultAssigneeId || ""} onChange={(e) => act(setCategoryDefaultAssigneeAction, c.id, e.target.value || null)} style={{ ...selStyle, maxWidth: 260 }}>
              <option value="">Nobody — the desk triages</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>,
          ])}
        />
      </section>
    </div>
  );
}

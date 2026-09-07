"use client";

import { useEffect, useState, useTransition } from "react";
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
  Modal,
  T,
  fmt,
} from "@/components/erp-ui";
import {
  createIncident,
  setIncidentStatus,
  markNemaNotified,
  deleteIncident,
  getIncidentDetail,
  addCorrectiveAction,
  setCorrectiveActionStatus,
  deleteCorrectiveAction,
  createRams,
  setRamsStatus,
  deleteRams,
  createPpe,
  returnPpe,
  deletePpe,
  createToolbox,
  deleteToolbox,
  createTraining,
  deleteTraining,
  createStatutory,
  setStatutoryStatus,
  deleteStatutory,
  createSite,
  deleteSite,
} from "@/app/db/actions/hse-actions";

// ── vocab ─────────────────────────────────────────────────────────────────────
const INC_TYPE = {
  near_miss: { label: "Near miss", variant: "blue" },
  first_aid: { label: "First aid", variant: "navy" },
  medical_treatment: { label: "Medical treatment", variant: "amber" },
  lost_time_injury: { label: "Lost-time injury", variant: "red" },
  positive_observation: { label: "Positive observation", variant: "green" },
};
const SEVERITY = {
  none: { label: "None", variant: "default" },
  low: { label: "Low", variant: "blue" },
  medium: { label: "Medium", variant: "amber" },
  high: { label: "High", variant: "amber" },
  critical: { label: "Critical", variant: "red" },
};
const INC_STATUS = {
  open: { label: "Open", variant: "amber" },
  under_investigation: { label: "Investigating", variant: "blue" },
  corrective_action_pending: { label: "Action pending", variant: "purple" },
  closed: { label: "Closed", variant: "green" },
};
const CA_STATUS = {
  open: { label: "Open", variant: "amber" },
  in_progress: { label: "In progress", variant: "blue" },
  completed: { label: "Completed", variant: "green" },
  overdue: { label: "Overdue", variant: "red" },
};
const RAMS_STATUS = {
  draft: { label: "Draft", variant: "default" },
  submitted: { label: "Submitted", variant: "blue" },
  under_review: { label: "Under review", variant: "amber" },
  approved: { label: "Approved", variant: "green" },
  rejected: { label: "Rejected", variant: "red" },
  expired: { label: "Expired", variant: "red" },
};
const PPE_COND = {
  new: { label: "New", variant: "green" },
  good: { label: "Good", variant: "blue" },
  worn: { label: "Worn", variant: "amber" },
  damaged: { label: "Damaged", variant: "red" },
};
const INS_STATUS = {
  scheduled: { label: "Scheduled", variant: "blue" },
  passed: { label: "Passed", variant: "green" },
  failed: { label: "Failed", variant: "red" },
  overdue: { label: "Overdue", variant: "red" },
};

const pill = (map, k) => {
  const c = map[k] || { label: k, variant: "default" };
  return <Badge variant={c.variant}>{c.label}</Badge>;
};
const opts = (map) => Object.keys(map).map((k) => ({ value: k, label: map[k].label }));
const inStyle = { width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13, color: "var(--foreground)", background: "var(--background)", boxSizing: "border-box" };

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "incidents", label: "Incidents" },
  { id: "rams", label: "RAMS Library" },
  { id: "ppe", label: "PPE Tracker" },
  { id: "toolbox", label: "Toolbox Talks" },
  { id: "training", label: "Training" },
  { id: "inspections", label: "Statutory Inspections" },
  { id: "sites", label: "Sites" },
];

export default function HseBoard({ data, canManage }) {
  const router = useRouter();
  const [tab, setTab] = useState("dashboard");
  const [, startTransition] = useTransition();
  const [modal, setModal] = useState(null); // { kind }
  const [incidentId, setIncidentId] = useState(null);
  const [busy, setBusy] = useState(false);

  const siteNames = (data.sites || []).map((s) => s.name);

  function act(fn, ...args) {
    return new Promise((resolve) => {
      setBusy(true);
      startTransition(async () => {
        const res = await fn(...args);
        if (res?.success) {
          toast.success(res.message);
          router.refresh();
        } else {
          toast.error(res?.error || "Something went wrong");
        }
        setBusy(false);
        resolve(res);
      });
    });
  }

  // Submit a FormData-based server action (signature: (prevState, formData)).
  async function submitForm(fn, form, { extra } = {}) {
    const fd = new FormData(form);
    if (extra) Object.entries(extra).forEach(([k, v]) => fd.set(k, v));
    return act(fn, null, fd);
  }

  const d = data.dashboard;

  return (
    <Page>
      <SectionHeader
        title="HSE"
        sub="Health, Safety & Environment — incidents, RAMS, PPE, training and statutory inspections."
        action={
          canManage ? (
            <Btn variant="gold" onClick={() => setModal({ kind: "incident" })}>+ Report Incident</Btn>
          ) : null
        }
      />

      <Tabs tabs={TABS} active={tab} setActive={setTab} />

      {tab === "dashboard" && <Dashboard d={d} />}

      {tab === "incidents" && (
        <TableSection
          canManage={canManage}
          addLabel="Report Incident"
          onAdd={() => setModal({ kind: "incident" })}
          headers={["Ref", "Type", "Severity", "Site", "Occurred", "Actions", "Status", ""]}
          rows={data.incidents.map((i) => [
            <button onClick={() => setIncidentId(i.id)} style={linkBtn}>{i.incident_number ?? i.incidentNumber}</button>,
            pill(INC_TYPE, i.type),
            pill(SEVERITY, i.severity),
            i.site_name || i.siteName || "—",
            fmt.date(i.occurred_at ?? i.occurredAt),
            `${i.open_action_count ?? 0}/${i.action_count ?? 0}`,
            pill(INC_STATUS, i.status),
            <RowActions canManage={canManage} onOpen={() => setIncidentId(i.id)} onDelete={() => act(deleteIncident, i.id)} busy={busy} />,
          ])}
          empty="No incidents logged. That's the goal — log near-misses too."
        />
      )}

      {tab === "rams" && (
        <TableSection
          canManage={canManage}
          addLabel="Upload RAMS"
          onAdd={() => setModal({ kind: "rams" })}
          headers={["Title", "Site", "Subcontractor", "Ver", "Status", "Reviewed", ""]}
          rows={data.rams.map((r) => [
            r.title,
            r.site_name || r.siteName || "—",
            r.subcontractor_name || r.subcontractorName || "—",
            `v${r.version}`,
            canManage ? <RowSelect value={r.status} options={opts(RAMS_STATUS)} onChange={(v) => act(setRamsStatus, r.id, v)} busy={busy} /> : pill(RAMS_STATUS, r.status),
            fmt.date(r.reviewed_at ?? r.reviewedAt),
            canManage ? <DelBtn onClick={() => act(deleteRams, r.id)} busy={busy} /> : null,
          ])}
          empty="No RAMS uploaded yet."
        />
      )}

      {tab === "ppe" && (
        <TableSection
          canManage={canManage}
          addLabel="Issue PPE"
          onAdd={() => setModal({ kind: "ppe" })}
          headers={["Item", "Employee", "Condition", "Issued", "Replacement due", "Returned", ""]}
          rows={data.ppe.map((p) => [
            p.item,
            p.employee_name || p.employeeName || "—",
            pill(PPE_COND, p.condition),
            fmt.date(p.issued_at ?? p.issuedAt),
            fmt.date(p.replacement_due_at ?? p.replacementDueAt),
            (p.returned_at ?? p.returnedAt) ? fmt.date(p.returned_at ?? p.returnedAt) : <span style={{ color: T.mgrey }}>In use</span>,
            canManage ? (
              <div style={{ display: "flex", gap: 6 }}>
                {!(p.returned_at ?? p.returnedAt) && <button onClick={() => act(returnPpe, p.id)} disabled={busy} style={miniBtn}>Return</button>}
                <DelBtn onClick={() => act(deletePpe, p.id)} busy={busy} />
              </div>
            ) : null,
          ])}
          empty="No PPE issues recorded."
        />
      )}

      {tab === "toolbox" && (
        <TableSection
          canManage={canManage}
          addLabel="Record Talk"
          onAdd={() => setModal({ kind: "toolbox" })}
          headers={["Topic", "Site", "Supervisor", "Held", "Attendees", ""]}
          rows={data.toolbox.map((t2) => [
            t2.topic,
            t2.site_name || t2.siteName || "—",
            t2.supervisor_name || t2.supervisorName || "—",
            fmt.date(t2.held_on ?? t2.heldOn),
            String(t2.attendee_count ?? t2.attendeeCount ?? 0),
            canManage ? <DelBtn onClick={() => act(deleteToolbox, t2.id)} busy={busy} /> : null,
          ])}
          empty="No toolbox talks recorded."
        />
      )}

      {tab === "training" && (
        <TableSection
          canManage={canManage}
          addLabel="Add Record"
          onAdd={() => setModal({ kind: "training" })}
          headers={["Employee", "Course", "Completed", "Expires", "Status", ""]}
          rows={data.training.map((r) => {
            const exp = r.expires_on ?? r.expiresOn;
            const state = !exp ? null : new Date(exp) < new Date() ? { l: "Expired", v: "red" } : new Date(exp) < new Date(Date.now() + 60 * 864e5) ? { l: "Expiring", v: "amber" } : { l: "Valid", v: "green" };
            return [
              r.employee_name || r.employeeName || "—",
              r.course,
              fmt.date(r.completed_on ?? r.completedOn),
              fmt.date(exp),
              state ? <Badge variant={state.v}>{state.l}</Badge> : "—",
              canManage ? <DelBtn onClick={() => act(deleteTraining, r.id)} busy={busy} /> : null,
            ];
          })}
          empty="No training records yet."
        />
      )}

      {tab === "inspections" && (
        <TableSection
          canManage={canManage}
          addLabel="Schedule Inspection"
          onAdd={() => setModal({ kind: "inspection" })}
          headers={["Equipment", "Site", "Inspector", "Last", "Due", "Status", ""]}
          rows={data.inspections.map((r) => {
            const due = r.due_date ?? r.dueDate;
            const overdue = r.status === "scheduled" && due && new Date(due) < new Date();
            return [
              r.equipment,
              r.site_name || r.siteName || "—",
              r.inspector_name || r.inspectorName || "—",
              fmt.date(r.last_inspected_at ?? r.lastInspectedAt),
              <span style={{ color: overdue ? T.red : undefined, fontWeight: overdue ? 700 : 400 }}>{fmt.date(due)}</span>,
              canManage ? <RowSelect value={r.status} options={opts(INS_STATUS)} onChange={(v) => act(setStatutoryStatus, r.id, v)} busy={busy} /> : pill(INS_STATUS, r.status),
              canManage ? <DelBtn onClick={() => act(deleteStatutory, r.id)} busy={busy} /> : null,
            ];
          })}
          empty="No statutory inspections scheduled."
        />
      )}

      {tab === "sites" && (
        <TableSection
          canManage={canManage}
          addLabel="Add Site"
          onAdd={() => setModal({ kind: "site" })}
          headers={["Site", "Location", "Project", "Status", ""]}
          rows={data.sites.map((s) => [
            s.name,
            s.location || "—",
            s.project_name || s.projectName || "—",
            (s.is_active ?? s.isActive) ? <Badge variant="green">Active</Badge> : <Badge>Inactive</Badge>,
            canManage ? <DelBtn onClick={() => act(deleteSite, s.id)} busy={busy} /> : null,
          ])}
          empty="No sites yet. Add one so incidents and inspections can be tied to it."
        />
      )}

      {/* ── create modals ── */}
      {modal?.kind === "incident" && (
        <FormModal title="Report Incident" width={640} busy={busy} onClose={() => setModal(null)}
          onSubmit={async (form) => { const r = await submitForm(createIncident, form); if (r?.success) setModal(null); }}>
          <Grid>
            <SelectF name="type" label="Type" options={opts(INC_TYPE)} />
            <SelectF name="severity" label="Severity" options={opts(SEVERITY)} defaultValue="low" />
            <SiteF sites={siteNames} />
            <InputF name="occurredAt" label="Occurred at" type="datetime-local" />
            <InputF name="reportedByName" label="Reported by" />
          </Grid>
          <TextF name="description" label="What happened" />
          <label style={checkRow}><input type="checkbox" name="isEnvironmental" /> Environmental / NEMA-reportable</label>
          <Grid>
            <InputF name="nemaRef" label="NEMA reference (if any)" />
            <label style={{ ...checkRow, marginTop: 22 }}><input type="checkbox" name="nemaNotificationRequired" /> NEMA notification required</label>
          </Grid>
        </FormModal>
      )}

      {modal?.kind === "rams" && (
        <FormModal title="Upload RAMS" busy={busy} onClose={() => setModal(null)}
          onSubmit={async (form) => { const r = await submitForm(createRams, form); if (r?.success) setModal(null); }}>
          <InputF name="title" label="Title" required />
          <Grid>
            <SiteF sites={siteNames} />
            <InputF name="subcontractorName" label="Subcontractor" />
          </Grid>
          <InputF name="fileUrl" label="Document link (URL)" placeholder="https://…" />
          <TextF name="issueNotes" label="Issue notes" />
        </FormModal>
      )}

      {modal?.kind === "ppe" && (
        <FormModal title="Issue PPE" busy={busy} onClose={() => setModal(null)}
          onSubmit={async (form) => { const r = await submitForm(createPpe, form); if (r?.success) setModal(null); }}>
          <Grid>
            <InputF name="item" label="Item" required placeholder="Hard hat, gloves…" />
            <InputF name="employeeName" label="Issued to" />
            <SelectF name="condition" label="Condition" options={opts(PPE_COND)} />
            <InputF name="issuedAt" label="Issued" type="date" />
            <InputF name="replacementDueAt" label="Replacement due" type="date" />
          </Grid>
        </FormModal>
      )}

      {modal?.kind === "toolbox" && (
        <FormModal title="Record Toolbox Talk" busy={busy} onClose={() => setModal(null)}
          onSubmit={async (form) => { const r = await submitForm(createToolbox, form); if (r?.success) setModal(null); }}>
          <InputF name="topic" label="Topic" required />
          <Grid>
            <SiteF sites={siteNames} />
            <InputF name="supervisorName" label="Supervisor" />
            <InputF name="heldOn" label="Held on" type="date" />
            <InputF name="attendeeCount" label="Attendees (count)" type="number" />
          </Grid>
          <TextF name="attendees" label="Attendee names" />
        </FormModal>
      )}

      {modal?.kind === "training" && (
        <FormModal title="Training Record" busy={busy} onClose={() => setModal(null)}
          onSubmit={async (form) => { const r = await submitForm(createTraining, form); if (r?.success) setModal(null); }}>
          <Grid>
            <InputF name="employeeName" label="Employee" />
            <InputF name="course" label="Course" required placeholder="First aid, fire safety…" />
            <InputF name="completedOn" label="Completed" type="date" />
            <InputF name="expiresOn" label="Expires" type="date" />
          </Grid>
          <InputF name="certificateUrl" label="Certificate link (URL)" placeholder="https://…" />
        </FormModal>
      )}

      {modal?.kind === "inspection" && (
        <FormModal title="Schedule Statutory Inspection" busy={busy} onClose={() => setModal(null)}
          onSubmit={async (form) => { const r = await submitForm(createStatutory, form); if (r?.success) setModal(null); }}>
          <InputF name="equipment" label="Equipment" required placeholder="Scaffolding, lifting gear, pressure vessel…" />
          <Grid>
            <SiteF sites={siteNames} />
            <InputF name="inspectorName" label="Inspector" />
            <InputF name="lastInspectedAt" label="Last inspected" type="date" />
            <InputF name="dueDate" label="Due date" type="date" />
          </Grid>
        </FormModal>
      )}

      {modal?.kind === "site" && (
        <FormModal title="Add Site" busy={busy} onClose={() => setModal(null)}
          onSubmit={async (form) => { const r = await submitForm(createSite, form); if (r?.success) setModal(null); }}>
          <InputF name="name" label="Site name" required />
          <Grid>
            <InputF name="location" label="Location" />
            <InputF name="projectName" label="Project (name)" />
          </Grid>
        </FormModal>
      )}

      {incidentId && (
        <IncidentDetail id={incidentId} canManage={canManage} act={act} busy={busy} onClose={() => setIncidentId(null)} />
      )}
    </Page>
  );
}

// ── Dashboard tab ──────────────────────────────────────────────────────────────
function Dashboard({ d }) {
  return (
    <>
      {d.daysSinceLti != null ? (
        <Alert type="success">{d.daysSinceLti} day{d.daysSinceLti === 1 ? "" : "s"} since the last lost-time injury.</Alert>
      ) : (
        <Alert type="success">No lost-time injury on record. Keep it that way.</Alert>
      )}
      {d.overdueActions > 0 && <Alert type="error">{d.overdueActions} corrective action{d.overdueActions === 1 ? " is" : "s are"} overdue.</Alert>}
      {d.inspectionsOverdue > 0 && <Alert type="warning">{d.inspectionsOverdue} statutory inspection{d.inspectionsOverdue === 1 ? " is" : "s are"} overdue.</Alert>}

      <StatGrid>
        <Stat label="TRIR" value={d.trir} sub="per 100 FTE" icon="📉" variant={d.trir > 3 ? "red" : "green"} />
        <Stat label="LTIF" value={d.ltif} sub="per 1M hours" icon="🩹" variant={d.lti ? "red" : "green"} />
        <Stat label="Near Misses (YTD)" value={d.nearMiss} icon="⚠️" variant="amber" />
        <Stat label="Incidents (YTD)" value={d.totalYtd} icon="📋" variant="blue" />
      </StatGrid>
      <StatGrid>
        <Stat label="Open Corrective Actions" value={d.openActions} icon="🛠️" variant={d.openActions ? "amber" : "green"} />
        <Stat label="Overdue Actions" value={d.overdueActions} icon="⏰" variant={d.overdueActions ? "red" : "green"} />
        <Stat label="RAMS Pending Approval" value={d.ramsPending} icon="📑" variant={d.ramsPending ? "amber" : undefined} />
        <Stat label="Training Expiring ≤60d" value={d.trainingExpiring} icon="🎓" variant={d.trainingExpiring ? "amber" : "green"} />
        <Stat label="Inspections Due ≤30d" value={d.inspectionsDue} icon="🔧" variant={d.inspectionsDue ? "amber" : "green"} />
        <Stat label="NEMA Notifications Pending" value={d.nemaPending} icon="🌿" variant={d.nemaPending ? "red" : "green"} />
      </StatGrid>
    </>
  );
}

// ── incident detail ─────────────────────────────────────────────────────────
function IncidentDetail({ id, canManage, act, busy, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCA, setShowCA] = useState(false);

  async function load() {
    setLoading(true);
    setData(await getIncidentDetail(id));
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function run(fn, ...args) {
    const r = await act(fn, ...args);
    if (r?.success) await load();
    return r;
  }

  const i = data?.incident;
  return (
    <Modal title={i ? `${i.incidentNumber} · ${INC_TYPE[i.type]?.label || i.type}` : "Incident"} onClose={onClose} width={760}>
      {loading || !i ? (
        <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Loading…</p>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {pill(SEVERITY, i.severity)}
            {pill(INC_STATUS, i.status)}
            {i.isEnvironmental && <Badge variant="green">Environmental</Badge>}
            {i.nemaNotificationRequired && !i.nemaNotifiedAt && <Badge variant="red">NEMA pending</Badge>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <Meta label="Site" value={i.siteName || "—"} />
            <Meta label="Occurred" value={i.occurredAt ? new Date(i.occurredAt).toLocaleString("en-KE") : "—"} />
            <Meta label="Reported by" value={i.reportedByName || "—"} />
            {i.nemaRef && <Meta label="NEMA ref" value={i.nemaRef} />}
          </div>
          {i.description && <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--foreground)", whiteSpace: "pre-wrap", background: "var(--muted)", padding: 12, borderRadius: 8 }}>{i.description}</p>}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 8px" }}>
            <h4 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted-foreground)", margin: 0 }}>Corrective actions</h4>
            {canManage && <button onClick={() => setShowCA((v) => !v)} style={miniBtn}>{showCA ? "Cancel" : "+ Add action"}</button>}
          </div>

          {showCA && canManage && (
            <form onSubmit={async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const r = await run(addCorrectiveAction, id, fd); if (r?.success) { setShowCA(false); } }} style={{ background: "var(--muted)", padding: 12, borderRadius: 8, marginBottom: 12 }}>
              <input name="description" placeholder="What must be done" required style={inStyle} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <input name="ownerName" placeholder="Owner" style={inStyle} />
                <input name="dueDate" type="date" style={inStyle} />
              </div>
              <button type="submit" disabled={busy} style={{ ...miniBtn, marginTop: 8, background: T.navy, color: "#fff" }}>Add corrective action</button>
            </form>
          )}

          {data.actions.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>No corrective actions yet.</p>
          ) : (
            data.actions.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--foreground)" }}>{a.description}</div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{a.ownerName || "Unassigned"} · due {fmt.date(a.dueDate)}</div>
                </div>
                {canManage ? (
                  <RowSelect value={a.status} options={opts(CA_STATUS)} onChange={(v) => run(setCorrectiveActionStatus, a.id, v)} busy={busy} />
                ) : pill(CA_STATUS, a.status)}
                {canManage && <DelBtn onClick={() => run(deleteCorrectiveAction, a.id)} busy={busy} />}
              </div>
            ))
          )}

          {canManage && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Status:</span>
              <select value={i.status} disabled={busy} onChange={(e) => run(setIncidentStatus, id, e.target.value)} style={{ ...inStyle, width: 200 }}>
                {opts(INC_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {i.nemaNotificationRequired && !i.nemaNotifiedAt && (
                <button onClick={() => run(markNemaNotified, id)} disabled={busy} style={{ ...miniBtn, background: T.green, color: "#fff" }}>Mark NEMA notified</button>
              )}
              <button onClick={async () => { if (confirm("Delete this incident?")) { const r = await act(deleteIncident, id); if (r?.success) onClose(); } }} disabled={busy} style={{ ...miniBtn, marginLeft: "auto", color: T.red, border: `1px solid ${T.red}`, background: "transparent" }}>Delete</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── small building blocks ──────────────────────────────────────────────────────
const linkBtn = { background: "none", border: "none", color: T.blue, fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 13 };
const miniBtn = { background: "var(--muted)", border: "1px solid var(--border)", color: "var(--foreground)", padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" };
const checkRow = { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--foreground)", margin: "6px 0 12px" };

function TableSection({ canManage, addLabel, onAdd, headers, rows, empty }) {
  return (
    <div>
      {canManage && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <Btn variant="outline" size="sm" onClick={onAdd}>+ {addLabel}</Btn>
        </div>
      )}
      <DataTable headers={headers} rows={rows} empty={empty} />
    </div>
  );
}

function RowActions({ canManage, onOpen, onDelete, busy }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button onClick={onOpen} style={miniBtn}>Open</button>
      {canManage && <DelBtn onClick={() => { if (confirm("Delete?")) onDelete(); }} busy={busy} />}
    </div>
  );
}

function DelBtn({ onClick, busy }) {
  return (
    <button onClick={onClick} disabled={busy} title="Delete" style={{ background: "transparent", border: "1px solid var(--border)", color: T.red, padding: "4px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>✕</button>
  );
}

function RowSelect({ value, options, onChange, busy }) {
  return (
    <select value={value} disabled={busy} onChange={(e) => onChange(e.target.value)} style={{ padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, background: "var(--background)", color: "var(--foreground)" }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Meta({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted-foreground)" }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}>{value}</div>
    </div>
  );
}

// Form primitives (native, so values post with the FormData).
function Grid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>{children}</div>;
}
function InputF({ name, label, type = "text", required, placeholder, defaultValue }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}{required ? " *" : ""}</label>
      <input name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue} style={inStyle} />
    </div>
  );
}
function TextF({ name, label }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      <textarea name={name} rows={3} style={{ ...inStyle, resize: "vertical" }} />
    </div>
  );
}
function SelectF({ name, label, options, defaultValue }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      <select name={name} defaultValue={defaultValue ?? options[0]?.value} style={inStyle}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
// A site chooser that also allows typing a free-text site name (datalist).
function SiteF({ sites }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>Site</label>
      <input name="siteName" list="hse-site-list" placeholder="Choose or type a site" style={inStyle} />
      <datalist id="hse-site-list">
        {(sites || []).map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}
const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--foreground)", marginBottom: 5 };

function FormModal({ title, width = 560, busy, onClose, onSubmit, children }) {
  return (
    <Modal title={title} onClose={onClose} width={width}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(e.currentTarget); }}>
        {children}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <button type="submit" disabled={busy} style={{ background: T.gold, color: "#fff", border: "none", padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

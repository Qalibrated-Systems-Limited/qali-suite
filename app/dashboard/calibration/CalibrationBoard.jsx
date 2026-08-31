"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, AlertTriangle } from "lucide-react";
import {
  createCalibrationJob,
  setCalibrationJobOutcome,
  deleteCalibrationJob,
  createCalibrationStandard,
  deleteCalibrationStandard,
} from "@/app/db/actions/technical-actions";
import { fmtDate } from "../technical/lib/meta";

const JOB_STATUS = [
  { v: "scheduled", label: "Scheduled", cls: "amber" },
  { v: "in_progress", label: "In progress", cls: "blue" },
  { v: "completed", label: "Completed", cls: "green" },
  { v: "cancelled", label: "Cancelled", cls: "slate" },
];
const RESULT = [
  { v: "pending", label: "Pending", cls: "slate" },
  { v: "passed", label: "Passed", cls: "green" },
  { v: "failed", label: "Failed", cls: "red" },
];
const BILLING = [
  { v: "pending", label: "Pending", cls: "slate" },
  { v: "invoiced", label: "Invoiced", cls: "green" },
];
const cfg = (arr, v) => arr.find((x) => x.v === v) || arr[0];

function Badge({ cls, children }) {
  return <span className={`tech-b ${cls}`}>{children}</span>;
}

function standardStatus(nextCal) {
  if (!nextCal) return { cls: "slate", label: "—" };
  const d = new Date(nextCal).getTime();
  const now = Date.now();
  if (d < now) return { cls: "red", label: "Expired" };
  if (d <= now + 60 * 86400000) return { cls: "amber", label: "Expiring" };
  return { cls: "green", label: "Valid" };
}

export default function CalibrationBoard({ jobs = [], standards = [], stats, canManage }) {
  const router = useRouter();
  const [tab, setTab] = useState("certs");
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState(null); // 'job' | 'standard' | null
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const certs = useMemo(() => jobs.filter((j) => j.certNumber), [jobs]);
  const filteredJobs = useMemo(() => {
    let l = jobs;
    if (statusFilter) l = l.filter((j) => j.status === statusFilter);
    if (q.trim()) {
      const s = q.toLowerCase();
      l = l.filter((j) =>
        [j.jobNumber, j.clientName, j.site, j.serviceType, j.technicianName]
          .some((x) => String(x || "").toLowerCase().includes(s)),
      );
    }
    return l;
  }, [jobs, statusFilter, q]);

  function act(fn, ...args) {
    startTransition(async () => {
      const res = await fn(...args);
      if (res?.success) {
        toast.success(res.message);
        setDialog(null);
        router.refresh();
      } else {
        toast.error(res?.error || "Something went wrong");
      }
    });
  }

  return (
    <>
      <div className="tech-bar">
        <span className="tech-bar-title">
          Technical Department
          <span className="count">ISO/IEC 17025 calibration</span>
        </span>
        <span className="tech-bar-spacer" />
        {canManage && (
          <button className="tech-btn-gold" onClick={() => setDialog("job")}>
            <Plus size={14} strokeWidth={3} /> New Cal Job
          </button>
        )}
      </div>

      <div className="tech-wrap">
        {stats.expiring > 0 && (
          <div className="tech-alert">
            <AlertTriangle size={16} />
            {stats.expiring} reference standard{stats.expiring === 1 ? " is" : "s are"} due for
            re-calibration within 60 days.
          </div>
        )}

        <div className="tech-stats">
          <Stat label="Certs Issued" value={stats.certs} />
          <Stat label="Passed" value={stats.passed} tone="green" />
          <Stat label="Reference Standards" value={stats.standards} tone="blue" />
          <Stat label="Expiring ≤60 days" value={stats.expiring} tone="amber" />
        </div>

        <div className="tech-tabs">
          <button className={`tech-tab ${tab === "certs" ? "on" : ""}`} onClick={() => setTab("certs")}>Certificates</button>
          <button className={`tech-tab ${tab === "standards" ? "on" : ""}`} onClick={() => setTab("standards")}>Reference Standards</button>
          <button className={`tech-tab ${tab === "jobs" ? "on" : ""}`} onClick={() => setTab("jobs")}>Cal Jobs</button>
        </div>

        {tab === "certs" && (
          <Table
            head={["Cert No", "Customer", "Service Type", "Location", "Issued", "Result"]}
            rows={certs.map((j) => [
              <span className="mono">{j.certNumber}</span>,
              j.clientName,
              j.serviceType || "—",
              j.site || "—",
              fmtDate(j.updatedAt),
              <Badge cls={cfg(RESULT, j.result).cls}>{cfg(RESULT, j.result).label}</Badge>,
            ])}
            empty="No certificates issued yet — complete a passed Cal Job to issue one."
          />
        )}

        {tab === "standards" && (
          <>
            {canManage && (
              <div className="tech-filters">
                <button className="tech-btn-ghost" onClick={() => setDialog("standard")}>
                  <Plus size={14} /> New Standard
                </button>
              </div>
            )}
            <Table
              head={["Standard", "Traceability", "Last Cal", "Next Cal", "Uncertainty", "Status", ""]}
              rows={standards.map((st) => {
                const s = standardStatus(st.nextCalibration);
                return [
                  st.name,
                  st.traceability || "—",
                  fmtDate(st.lastCalibration),
                  fmtDate(st.nextCalibration),
                  st.uncertainty || "—",
                  <Badge cls={s.cls}>{s.label}</Badge>,
                  canManage ? (
                    <button className="tech-rowbtn" onClick={() => act(deleteCalibrationStandard, st.id)} disabled={isPending} aria-label="Delete">
                      <Trash2 size={14} />
                    </button>
                  ) : null,
                ];
              })}
              empty="No reference standards recorded."
            />
          </>
        )}

        {tab === "jobs" && (
          <>
            <div className="tech-filters">
              <input className="tech-input" placeholder="Search job, client, technician…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="tech-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {JOB_STATUS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </div>
            <Table
              head={["Job No", "Client", "Site", "Scheduled", "Technician", "Status", "Result", "Billing", ""]}
              rows={filteredJobs.map((j) => [
                <span className="mono">{j.jobNumber}</span>,
                j.clientName,
                j.site || "—",
                fmtDate(j.scheduledDate),
                j.technicianName || "—",
                canManage ? (
                  <RowSelect options={JOB_STATUS} value={j.status} disabled={isPending} onChange={(v) => act(setCalibrationJobOutcome, j.id, { status: v })} />
                ) : <Badge cls={cfg(JOB_STATUS, j.status).cls}>{cfg(JOB_STATUS, j.status).label}</Badge>,
                canManage ? (
                  <RowSelect options={RESULT} value={j.result} disabled={isPending} onChange={(v) => act(setCalibrationJobOutcome, j.id, { result: v })} />
                ) : <Badge cls={cfg(RESULT, j.result).cls}>{cfg(RESULT, j.result).label}</Badge>,
                canManage ? (
                  <RowSelect options={BILLING} value={j.billingStatus} disabled={isPending} onChange={(v) => act(setCalibrationJobOutcome, j.id, { billingStatus: v })} />
                ) : <Badge cls={cfg(BILLING, j.billingStatus).cls}>{cfg(BILLING, j.billingStatus).label}</Badge>,
                canManage ? (
                  <button className="tech-rowbtn" onClick={() => act(deleteCalibrationJob, j.id)} disabled={isPending} aria-label="Delete"><Trash2 size={14} /></button>
                ) : null,
              ])}
              empty="No calibration jobs yet."
            />
          </>
        )}
      </div>

      {dialog === "job" && (
        <Dialog title="New Cal Job" sub="Schedule a calibration job." onClose={() => setDialog(null)}>
          <form action={(fd) => act(createCalibrationJob, null, fd)}>
            <div className="tech-form-grid">
              <Field name="clientName" label="Client (company)" required />
              <Field name="site" label="Site / location" />
              <Field name="serviceType" label="Service type" placeholder="Mass / Temperature / Pressure…" />
              <Field name="scheduledDate" label="Scheduled date" type="date" />
              <Field name="technicianName" label="Technician" />
              <SelectField name="status" label="Status" options={JOB_STATUS} />
            </div>
            <FieldFull name="notes" label="Notes" textarea />
            <DialogActions pending={isPending} onCancel={() => setDialog(null)} submit="Create job" />
          </form>
        </Dialog>
      )}

      {dialog === "standard" && (
        <Dialog title="New Reference Standard" sub="Add a traceable reference standard." onClose={() => setDialog(null)}>
          <form action={(fd) => act(createCalibrationStandard, null, fd)}>
            <div className="tech-form-grid">
              <Field name="name" label="Standard name" required />
              <Field name="traceability" label="Traceability" placeholder="KEBS → BIPM" />
              <Field name="lastCalibration" label="Last calibration" type="date" />
              <Field name="nextCalibration" label="Next calibration" type="date" />
              <Field name="uncertainty" label="Uncertainty" placeholder="± 0.05 mg" />
            </div>
            <DialogActions pending={isPending} onCancel={() => setDialog(null)} submit="Add standard" />
          </form>
        </Dialog>
      )}
    </>
  );
}

// ── small building blocks (shared look) ──────────────────────────────────────
function Stat({ label, value, tone }) {
  return (
    <div className={`tech-stat ${tone || ""}`}>
      <div className="sl">{label}</div>
      <div className="sv">{value ?? 0}</div>
    </div>
  );
}
function Table({ head, rows, empty }) {
  if (!rows.length) return <div className="tech-empty2">{empty}</div>;
  return (
    <div className="tech-tablewrap">
      <table className="tech-table">
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
function RowSelect({ options, value, onChange, disabled }) {
  return (
    <select className="tech-rowbtn" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}
export function Dialog({ title, sub, children, onClose }) {
  return (
    <div className="tech-overlay" onClick={onClose}>
      <div className="tech-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {sub && <p className="dsub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}
export function Field({ name, label, type = "text", required, placeholder }) {
  return (
    <div className="tech-field">
      <label className="tech-label">{label}{required ? " *" : ""}</label>
      <input className="tech-input" name={name} type={type} required={required} placeholder={placeholder} />
    </div>
  );
}
export function FieldFull({ name, label, textarea }) {
  return (
    <div className="tech-field" style={{ marginTop: 12 }}>
      <label className="tech-label">{label}</label>
      {textarea ? <textarea className="tech-textarea" name={name} rows={2} /> : <input className="tech-input" name={name} />}
    </div>
  );
}
export function SelectField({ name, label, options }) {
  return (
    <div className="tech-field">
      <label className="tech-label">{label}</label>
      <select className="tech-select" name={name} defaultValue={options[0].v}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </div>
  );
}
export function DialogActions({ pending, onCancel, submit }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
      <button type="button" className="tech-btn-ghost" onClick={onCancel} disabled={pending}>Cancel</button>
      <button type="submit" className="tech-btn-gold" disabled={pending}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : null}
        {submit}
      </button>
    </div>
  );
}

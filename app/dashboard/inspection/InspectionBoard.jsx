"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Trash2 } from "lucide-react";
import {
  createInspection,
  setInspectionOutcome,
  deleteInspection,
} from "@/app/db/actions/technical-actions";
import { fmtDate } from "../technical/lib/meta";

const RULING = [
  { v: "pending", label: "Pending", cls: "slate" },
  { v: "pass", label: "Pass", cls: "green" },
  { v: "fail", label: "Fail", cls: "red" },
  { v: "quarantined", label: "Quarantined", cls: "amber" },
];
const APPEAL = [
  { v: "none", label: "No appeal", cls: "slate" },
  { v: "open", label: "Open", cls: "amber" },
  { v: "upheld", label: "Upheld", cls: "green" },
  { v: "dismissed", label: "Dismissed", cls: "red" },
];
const cfg = (arr, v) => arr.find((x) => x.v === v) || arr[0];

function Badge({ cls, children }) {
  return <span className={`tech-b ${cls}`}>{children}</span>;
}

export default function InspectionBoard({ inspections = [], inspectors = [], stats, canManage }) {
  const router = useRouter();
  const [tab, setTab] = useState("inspections");
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rulingFilter, setRulingFilter] = useState("");

  const appeals = useMemo(() => inspections.filter((i) => i.appealStatus !== "none"), [inspections]);
  const filtered = useMemo(() => {
    let l = inspections;
    if (rulingFilter) l = l.filter((i) => i.ruling === rulingFilter);
    if (q.trim()) {
      const s = q.toLowerCase();
      l = l.filter((i) =>
        [i.inspectionNumber, i.type, i.equipmentSerial, i.clientName, i.inspectorName]
          .some((x) => String(x || "").toLowerCase().includes(s)),
      );
    }
    return l;
  }, [inspections, rulingFilter, q]);

  function act(fn, ...args) {
    startTransition(async () => {
      const res = await fn(...args);
      if (res?.success) {
        toast.success(res.message);
        setOpen(false);
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
          Inspection (17020)
          <span className="count">ISO/IEC 17020 inspection bodies, rulings &amp; appeals</span>
        </span>
        <span className="tech-bar-spacer" />
        {canManage && (
          <button className="tech-btn-gold" onClick={() => setOpen(true)}>
            <Plus size={14} strokeWidth={3} /> New Inspection
          </button>
        )}
      </div>

      <div className="tech-wrap">
        <div className="tech-stats">
          <Stat label="Open Inspections" value={stats.openInspections} />
          <Stat label="Failed / Quarantined" value={stats.failedQuarantined} tone="red" />
          <Stat label="Open Appeals" value={stats.openAppeals} tone="amber" />
          <Stat label="Auth. Expiring ≤30d" value={stats.authExpiring} tone="amber" />
        </div>

        <div className="tech-tabs">
          <button className={`tech-tab ${tab === "inspections" ? "on" : ""}`} onClick={() => setTab("inspections")}>Inspections</button>
          <button className={`tech-tab ${tab === "inspectors" ? "on" : ""}`} onClick={() => setTab("inspectors")}>Inspectors</button>
          <button className={`tech-tab ${tab === "appeals" ? "on" : ""}`} onClick={() => setTab("appeals")}>Appeals</button>
        </div>

        {tab === "inspections" && (
          <>
            <div className="tech-filters">
              <input className="tech-input" placeholder="Search inspection, client, inspector…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="tech-select" value={rulingFilter} onChange={(e) => setRulingFilter(e.target.value)}>
                <option value="">All rulings</option>
                {RULING.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
              </select>
            </div>
            <Table
              head={["Inspection No.", "Type", "Equipment S/N", "Client", "Inspector", "Ruling", ""]}
              rows={filtered.map((i) => [
                <span className="mono">{i.inspectionNumber}</span>,
                i.type || "—",
                i.equipmentSerial || "—",
                i.clientName,
                i.inspectorName || "—",
                canManage ? (
                  <RowSelect options={RULING} value={i.ruling} disabled={isPending} onChange={(v) => act(setInspectionOutcome, i.id, { ruling: v })} />
                ) : <Badge cls={cfg(RULING, i.ruling).cls}>{cfg(RULING, i.ruling).label}</Badge>,
                canManage ? (
                  <button className="tech-rowbtn" onClick={() => act(deleteInspection, i.id)} disabled={isPending} aria-label="Delete"><Trash2 size={14} /></button>
                ) : null,
              ])}
              empty="No inspections yet."
            />
          </>
        )}

        {tab === "inspectors" && (
          <Table
            head={["Inspector", "Total", "Passed", "Failed"]}
            rows={inspectors.map((p) => [p.name, p.total, p.passed, p.failed])}
            empty="No inspectors recorded yet — they appear here once inspections name them."
          />
        )}

        {tab === "appeals" && (
          <Table
            head={["Inspection No.", "Client", "Ruling", "Appeal", ""]}
            rows={appeals.map((i) => [
              <span className="mono">{i.inspectionNumber}</span>,
              i.clientName,
              <Badge cls={cfg(RULING, i.ruling).cls}>{cfg(RULING, i.ruling).label}</Badge>,
              canManage ? (
                <RowSelect options={APPEAL} value={i.appealStatus} disabled={isPending} onChange={(v) => act(setInspectionOutcome, i.id, { appealStatus: v })} />
              ) : <Badge cls={cfg(APPEAL, i.appealStatus).cls}>{cfg(APPEAL, i.appealStatus).label}</Badge>,
              null,
            ])}
            empty="No appeals lodged."
          />
        )}

        {canManage && tab === "inspections" && appeals.length === 0 && filtered.length > 0 && (
          <p className="tech-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Tip: set an inspection&apos;s appeal from the Appeals tab once one is lodged (change its ruling first).
          </p>
        )}
      </div>

      {open && (
        <div className="tech-overlay" onClick={() => setOpen(false)}>
          <div className="tech-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>New Inspection</h3>
            <p className="dsub">Log an ISO 17020 inspection.</p>
            <form action={(fd) => act(createInspection, null, fd)}>
              <div className="tech-form-grid">
                <Field name="clientName" label="Client (company)" required />
                <Field name="type" label="Type" placeholder="Lifting Gear / Crane / Pressure Vessel…" />
                <Field name="equipmentSerial" label="Equipment S/N" />
                <Field name="inspectorName" label="Inspector" />
                <Field name="scheduledDate" label="Scheduled date" type="date" />
                <Field name="authorityExpiry" label="Authority expiry" type="date" />
                <SelectField name="ruling" label="Ruling" options={RULING} />
              </div>
              <div className="tech-field" style={{ marginTop: 12 }}>
                <label className="tech-label">Notes</label>
                <textarea className="tech-textarea" name="notes" rows={2} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                <button type="button" className="tech-btn-ghost" onClick={() => setOpen(false)} disabled={isPending}>Cancel</button>
                <button type="submit" className="tech-btn-gold" disabled={isPending}>
                  {isPending ? <Loader2 size={14} className="animate-spin" /> : null} Create inspection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

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
        <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}</tbody>
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
function Field({ name, label, type = "text", required, placeholder }) {
  return (
    <div className="tech-field">
      <label className="tech-label">{label}{required ? " *" : ""}</label>
      <input className="tech-input" name={name} type={type} required={required} placeholder={placeholder} />
    </div>
  );
}
function SelectField({ name, label, options }) {
  return (
    <div className="tech-field">
      <label className="tech-label">{label}</label>
      <select className="tech-select" name={name} defaultValue={options[0].v}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pill, COAL, GOLD, INK, MUTE, FAIL, findingsCount } from "./ui";
import { sheetName, displaySerial, sheetsByCategory, sheetCategory } from "../lib/meta";
import { templateByCode } from "../lib/templates";

/**
 * The report registry, as the Workflow Reports app shows it: status chips and
 * a search on one line, more filters tucked away, a count line with the
 * last-24-hours badge, and the coal-headed table — newest first, a gold edge
 * and a NEW tag on anything filed in the last day, findings counted in red.
 * Click a row for the report.
 *
 * The app fetches from its API and polls; here the server hands over every
 * report in the company and the filters run in the browser. The search reads
 * the serial, sheet, client, site, weighbridge, project, author and what was
 * written on the sheet itself (equipment, findings, work done, remarks), so a
 * report can be found by what it says.
 */

/** Everything a report says, as one lower-case string for the search. */
function searchText(r) {
  const d = r.data || {};
  const parts = [
    ...Object.values(d.header || {}),
    ...Object.values(d.values || {}).map((v) => (Array.isArray(v) ? v.join(" ") : v)),
    ...Object.values(d.checks || {}).map((c) => c?.remark),
    ...Object.values(d.grids || {}),
    r.title,
    r.summary,
    r.workCompleted,
    r.issues,
    r.nextSteps,
  ];
  return parts.filter((v) => v != null && v !== "").join(" ").toLowerCase();
}

const FILTERS = [
  ["all", "All"],
  ["draft", "Drafts"],
  ["submitted", "Supervisor review"],
  ["reviewed", "Manager approval"],
  ["approved", "Approved"],
];

const FILTERS_KEY = "qsl_tech_registry_filters";
const INACTIVITY_MS = 2 * 60 * 1000;
const RECENT_MS = 24 * 60 * 60 * 1000;

const isRecent = (r) => {
  const t = new Date(r.createdAt).getTime();
  return !Number.isNaN(t) && Date.now() - t < RECENT_MS;
};
const shortDate = (d) => {
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
};
const reportDate = (r) => r.periodStart || r.createdAt;

export default function Registry({ reports = [], projects = [], initialProjectId = "", role = "" }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [template, setTemplate] = useState("");
  const [kind, setKind] = useState("");
  const [projectId, setProjectId] = useState(initialProjectId);
  const [showMore, setShowMore] = useState(Boolean(initialProjectId));

  // Filters survive a quick trip into a report and back, then clear after two
  // idle minutes — the app's behaviour.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const st = p.get("status");
      const tpl = p.get("template");
      if (st || tpl) {
        if (st) setFilter(st);
        if (tpl) setTemplate(tpl);
        return;
      }
      const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) || "null");
      if (saved && Date.now() - (saved.savedAt || 0) < INACTIVITY_MS) {
        setFilter(saved.filter || "all");
        setQ(saved.q || "");
        setName(saved.name || "");
        setFrom(saved.from || "");
        setTo(saved.to || "");
        setTemplate(saved.template || "");
      } else {
        localStorage.removeItem(FILTERS_KEY);
      }
    } catch {
      /* storage unavailable */
    }
  }, []);

  const clearFilters = () => {
    setFilter("all");
    setQ("");
    setName("");
    setFrom("");
    setTo("");
    setTemplate("");
    setKind("");
    setProjectId("");
  };
  const anyFilter = filter !== "all" || q || name || from || to || template || kind || projectId;

  useEffect(() => {
    try {
      if (anyFilter)
        localStorage.setItem(FILTERS_KEY, JSON.stringify({ filter, q, name, from, to, template, savedAt: Date.now() }));
      else localStorage.removeItem(FILTERS_KEY);
    } catch {
      /* storage unavailable */
    }
  }, [anyFilter, filter, q, name, from, to, template]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const who = name.trim().toLowerCase();
    return reports
      .map((r) => {
        const tpl = templateByCode(r.type);
        const h = r.data?.header || {};
        return {
          ...r,
          serial: displaySerial(r.reportNumber),
          service: sheetName(r.type),
          client: h.client || "",
          site: h.site || "",
          weighbridge: h.weighbridge || "",
          findings: findingsCount(r, tpl),
        };
      })
      .filter((r) => filter === "all" || r.status === filter)
      .filter((r) => !template || r.type === template)
      .filter((r) => !kind || sheetCategory(r.type) === kind)
      .filter((r) => !projectId || r.projectId === projectId)
      .filter(
        (r) =>
          !needle ||
          [r.serial, r.service, r.type, r.createdByName, r.projectNumber, r.projectName]
            .join(" ")
            .toLowerCase()
            .includes(needle) ||
          searchText(r).includes(needle),
      )
      .filter((r) => !who || [r.createdByName, r.client].join(" ").toLowerCase().includes(who))
      .filter((r) => {
        const d = String(reportDate(r) || "").slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      });
  }, [reports, filter, template, kind, projectId, q, name, from, to]);

  const exportCsv = () => {
    const out = [["serial", "template", "project", "author", "client", "site", "weighbridge", "findings", "status", "report_date", "filed_at"]].concat(
      rows.map((r) => [r.serial, r.service, r.projectNumber, r.createdByName, r.client, r.site, r.weighbridge, r.findings, r.status, reportDate(r), r.createdAt]),
    );
    const csv = out.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "qsl_report_register.csv";
    a.click();
  };

  const recentCount = rows.filter(isRecent).length;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 12 }}>
        <div>
          <p className="eyebrow">{role}</p>
          <h1 className="h1">Report registry</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => router.refresh()} style={{ fontSize: 12 }}>
            Refresh
          </button>
          <button className="btn btn-dark" onClick={exportCsv} style={{ fontSize: 12 }}>
            Export CSV
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "12px 0 8px" }}>
        {FILTERS.map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className="btn"
            style={filter === k ? { background: COAL, color: GOLD, borderColor: COAL, fontSize: 12 } : { fontSize: 12 }}
          >
            {l}
          </button>
        ))}
        <input
          className="input"
          placeholder="Search serial, client, site, equipment, findings, author…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: "1 1 220px", minWidth: 180, fontSize: 13, width: "auto" }}
        />
        <button className="btn" onClick={() => setShowMore((v) => !v)} style={{ fontSize: 12 }}>
          {showMore ? "Fewer filters" : "More filters"}
        </button>
        {anyFilter && (
          <button className="btn" onClick={clearFilters} style={{ fontSize: 12, color: FAIL }}>
            Clear
          </button>
        )}
      </div>

      {(showMore || template || kind || projectId) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end", marginBottom: 10 }}>
          <label className="field" style={{ margin: 0, flex: "1 1 180px" }}>
            <span className="label">Filed by (name / client)</span>
            <input className="input" placeholder="e.g. John or TATA" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span className="label">From date</span>
            <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span className="label">To date</span>
            <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="field" style={{ margin: 0, flex: "1 1 200px" }}>
            <span className="label">Project</span>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectNumber} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ margin: 0, flex: "1 1 180px" }}>
            <span className="label">Kind of work</span>
            <select className="input" value={kind} onChange={(e) => { setKind(e.target.value); setTemplate(""); }}>
              <option value="">All kinds</option>
              {sheetsByCategory().map((g) => (
                <option key={g.category} value={g.category}>
                  {g.category}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ margin: 0, flex: "1 1 220px" }}>
            <span className="label">Sheet</span>
            <select className="input" value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">All sheets</option>
              {sheetsByCategory()
                .filter((g) => !kind || g.category === kind)
                .map((g) => (
                  <optgroup key={g.category} label={g.category}>
                    {g.sheets.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.code} — {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
          </label>
        </div>
      )}

      <div className="muted" style={{ fontSize: 12.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>
          <b style={{ color: INK }}>{rows.length}</b> record{rows.length === 1 ? "" : "s"}
          {anyFilter ? " match your filters" : ""} · click a row for full detail
        </span>
        {recentCount > 0 && (
          <span style={{ background: GOLD, color: COAL, fontWeight: 800, fontSize: 11, padding: "2px 8px", borderRadius: 999 }}>
            {recentCount} new · last 24h
          </span>
        )}
      </div>

      {rows.length === 0 && (
        <div className="card" style={{ borderStyle: "dashed", padding: 24, textAlign: "center", color: MUTE }}>
          {anyFilter ? "No reports match these filters. Try widening the dates or clearing filters." : "Nothing here yet. Tap New report to start."}
        </div>
      )}

      {rows.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
              <thead>
                <tr style={{ background: COAL, color: "#fff", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em" }}>
                  <Th center>#</Th>
                  <Th>Date</Th>
                  <Th>Serial</Th>
                  <Th>Service</Th>
                  <Th>Project</Th>
                  <Th>Weighbridge</Th>
                  <Th>Client / Branch</Th>
                  <Th>Filed by</Th>
                  <Th center>Findings</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const recent = isRecent(r);
                  return (
                    <tr
                      key={r.id}
                      className="reg-row"
                      onClick={() => router.push(`/dashboard/technical/${r.id}`)}
                      style={{
                        cursor: "pointer",
                        borderTop: "1px solid #eee4d0",
                        background: recent ? "#fffdf4" : i % 2 ? "#faf7f0" : "#fff",
                        boxShadow: recent ? `inset 3px 0 0 ${GOLD}` : "none",
                      }}
                    >
                      <td style={{ ...td, textAlign: "center", color: MUTE, fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700 }} title="Registry number (1 = latest)">
                        {i + 1}
                      </td>
                      <td style={td} title={new Date(reportDate(r)).toLocaleString()}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{shortDate(reportDate(r))}</span>
                      </td>
                      <td style={td}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, color: "#7a5c00" }}>{r.serial}</span>
                        {recent && (
                          <span style={{ marginLeft: 6, background: GOLD, color: COAL, fontSize: 9, fontWeight: 900, letterSpacing: ".04em", padding: "1px 5px", borderRadius: 3 }}>
                            NEW
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, fontWeight: 600 }}>{r.service}</td>
                      <td style={{ ...td, fontSize: 12 }}>
                        <div style={{ fontFamily: "var(--mono)", color: MUTE }}>{r.projectNumber || "—"}</div>
                        {r.projectName ? <div className="muted" style={{ fontSize: 11 }}>{r.projectName}</div> : null}
                      </td>
                      <td style={{ ...td, color: r.weighbridge ? INK : "#b8af9e", fontFamily: r.weighbridge ? "var(--mono)" : "inherit", fontSize: 12 }}>
                        {r.weighbridge || "—"}
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 700, color: INK }}>{r.client || "—"}</div>
                        {r.site ? <div className="muted" style={{ fontSize: 11 }}>{r.site}</div> : null}
                      </td>
                      <td style={td}>{r.createdByName || "—"}</td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {r.findings > 0 ? (
                          <span style={{ color: "#fff", background: FAIL, fontWeight: 800, fontSize: 11, padding: "1px 7px", borderRadius: 999 }}>{r.findings}</span>
                        ) : (
                          <span style={{ color: "#b8af9e" }}>—</span>
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        <Pill status={r.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const td = { padding: "8px 12px", fontSize: 13, color: INK, verticalAlign: "middle" };

function Th({ children, center }) {
  return <th style={{ padding: "9px 12px", textAlign: center ? "center" : "left", fontWeight: 800, whiteSpace: "nowrap" }}>{children}</th>;
}

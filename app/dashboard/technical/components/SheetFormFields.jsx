"use client";

import { defaultStates, STATE_COLOR } from "../lib/templates";

/**
 * Renders a QSL sheet's own sections (checklists, measurement fields, the
 * End–Middle–End test, parts/calibration grids, choices) into one `data`
 * object, ported from the standalone app's ReportForm. Controlled: the parent
 * owns `data` and gets every change through `onChange`.
 *
 * data = { header:{client,site,weighbridge}, values:{}, checks:{}, runs:{}, grids:{} }
 */
export default function SheetFormFields({ template, data, onChange }) {
  const d = {
    header: data?.header || {},
    values: data?.values || {},
    checks: data?.checks || {},
    runs: data?.runs || {},
    grids: data?.grids || {},
  };

  const patch = (part, key, value) =>
    onChange({ ...d, [part]: { ...d[part], [key]: value } });

  const setHeader = (k, v) => patch("header", k, v);
  const setValue = (k, v) => patch("values", k, v);
  const setRun = (k, v) => patch("runs", k, v);
  const setGrid = (k, v) => patch("grids", k, v);
  const setCheck = (k, next) => patch("checks", k, next);

  return (
    <>
      {/* Header — who/where the report is for */}
      <div className="tech-form-grid">
        <div className="tech-field">
          <label className="tech-label">Client (company)</label>
          <input className="tech-input" value={d.header.client || ""} onChange={(e) => setHeader("client", e.target.value)} placeholder="e.g. TATA Chemicals" />
        </div>
        <div className="tech-field">
          <label className="tech-label">Site / branch</label>
          <input className="tech-input" value={d.header.site || ""} onChange={(e) => setHeader("site", e.target.value)} placeholder="e.g. Kajiado" />
        </div>
        <div className="tech-field">
          <label className="tech-label">Weighbridge</label>
          <input className="tech-input" value={d.header.weighbridge || ""} onChange={(e) => setHeader("weighbridge", e.target.value)} placeholder="e.g. WB-4" />
        </div>
      </div>

      <div className="tech-sheet-flow">
      {(template.sections || []).map((sec, si) => {
        if (sec.type === "fields")
          return (
            <div className="tech-form-grid span-all" key={si} style={{ marginTop: 12 }}>
              {sec.fields.map((f) => (
                <div className="tech-field" key={f.k}>
                  <label className="tech-label">{f.label}</label>
                  <input
                    className="tech-input"
                    type={f.inputType || "text"}
                    value={d.values[f.k] || ""}
                    onChange={(e) => setValue(f.k, e.target.value)}
                  />
                </div>
              ))}
            </div>
          );

        if (sec.type === "textarea")
          return (
            <div key={si}>
              <div className="tech-sectionbar">{sec.label}</div>
              <textarea className="tech-textarea" rows={3} value={d.values[sec.k] || ""} onChange={(e) => setValue(sec.k, e.target.value)} />
            </div>
          );

        if (sec.type === "checklist") {
          const states = sec.states || defaultStates(sec.yes, sec.no);
          const reslen = states.length >= 3 ? "216px" : "150px";
          return (
            <div key={si} className="span-all">
              <div className="tech-sectionbar">{sec.title}</div>
              <div className="tech-scroll">
                <div className="tech-check" style={{ "--reslen": reslen }}>
                  <div className="tech-check-head">
                    <span>Item</span>
                    <span style={{ textAlign: "center", justifyContent: "center" }}>
                      Result — {states.map((s) => s.label).join(" / ")}
                    </span>
                    <span>Remarks</span>
                  </div>
                  {sec.items.map((it, ii) => {
                    const key = `${si}:${ii}`;
                    const cur = d.checks[key] || {};
                    const flagged = cur.state && cur.state !== states[0].key;
                    return (
                      <div className="tech-check-row" key={ii}>
                        <div className="cell">{it}</div>
                        <div className="cell">
                          <div className="tech-pills">
                            {states.map((s) => {
                              const on = cur.state === s.key;
                              const col = STATE_COLOR[s.key] || "var(--tech-red)";
                              return (
                                <button
                                  key={s.key}
                                  type="button"
                                  className="tech-pill"
                                  onClick={() => setCheck(key, { ...cur, state: s.key })}
                                  style={{
                                    borderColor: col,
                                    background: on ? col : "var(--card)",
                                    color: on ? "#fff" : col,
                                  }}
                                >
                                  {on && (s.key === "ok" || s.key === "pass") ? "✓ " : ""}
                                  {s.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="cell">
                          <input
                            className="tech-remark"
                            style={flagged ? { borderColor: "var(--tech-red)" } : undefined}
                            placeholder={flagged ? "What needs attention" : "Remark (optional)"}
                            value={cur.remark || ""}
                            onChange={(e) => setCheck(key, { ...cur, remark: e.target.value })}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        }

        if (sec.type === "choices" && sec.dropdown)
          return (
            <div key={si}>
              <div className="tech-sectionbar">{sec.title}</div>
              <select className="tech-select" style={{ maxWidth: 420 }} value={d.values[sec.k] || ""} onChange={(e) => setValue(sec.k, e.target.value)}>
                <option value="">Select…</option>
                {sec.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          );

        if (sec.type === "choices") {
          const selected = sec.multi
            ? String(d.values[sec.k] || "").split(",").map((s) => s.trim()).filter(Boolean)
            : [];
          const isOn = (o) => (sec.multi ? selected.includes(o) : d.values[sec.k] === o);
          const toggle = (o) => {
            if (!sec.multi) return setValue(sec.k, o);
            const next = selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o];
            setValue(sec.k, sec.options.filter((x) => next.includes(x)).join(", "));
          };
          return (
            <div key={si}>
              <div className="tech-sectionbar">{sec.title}</div>
              {sec.multi && <p className="tech-muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Pick all that apply.</p>}
              <div className="tech-choices">
                {sec.options.map((o) => (
                  <button key={o} type="button" className={`tech-choice ${isOn(o) ? "on" : ""}`} onClick={() => toggle(o)}>
                    {sec.multi ? (isOn(o) ? "☑ " : "☐ ") : ""}
                    {o}
                  </button>
                ))}
              </div>
            </div>
          );
        }

        if (sec.type === "weekly")
          return (
            <div key={si} className="span-all">
              <div className="tech-sectionbar">End — Middle — End test (same truck)</div>
              {[1, 2].map((r) => (
                <div className="tech-run" key={r}>
                  <span className="runlabel">Run {r}</span>
                  {["a", "m", "b"].map((p, i) => (
                    <label key={p}>
                      <span className="tech-mini">{["End A", "Middle", "End B"][i]} kg</span>
                      <input className="tech-input" type="number" value={d.runs[`${r}${p}`] || ""} onChange={(e) => setRun(`${r}${p}`, e.target.value)} />
                    </label>
                  ))}
                </div>
              ))}
            </div>
          );

        if (sec.type === "loadcells") {
          const unit = d.grids.lcUnit || "mV";
          const rows = [
            { key: "lc", label: unit === "ohm" ? "Impedance (Ω)" : "Output (mV)" },
            { key: "corner", label: "Corner (kg)" },
          ];
          return (
            <div key={si} className="span-all">
              <div className="tech-sectionbar">Load cell readings</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
                <span className="tech-muted" style={{ fontSize: 12, fontWeight: 700 }}>Measure:</span>
                {[{ k: "mV", label: "Output (mV)" }, { k: "ohm", label: "Impedance (Ω)" }].map((opt) => (
                  <button
                    key={opt.k}
                    type="button"
                    className={`tech-choice ${unit === opt.k ? "on" : ""}`}
                    style={{ padding: "6px 12px", flex: "0 0 auto" }}
                    onClick={() => setGrid("lcUnit", opt.k)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {rows.map((row) => (
                <div key={row.key} style={{ marginBottom: 8 }}>
                  <span className="tech-mini" style={{ fontWeight: 700 }}>{row.label}</span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4, marginTop: 4 }}>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <input key={i} className="tech-input" type="number" style={{ textAlign: "right" }} placeholder={`#${i + 1}`} value={d.grids[`${row.key}:${i}`] || ""} onChange={(e) => setGrid(`${row.key}:${i}`, e.target.value)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        }

        if (sec.type === "rows")
          return (
            <div key={si} className="span-all">
              <div className="tech-sectionbar">{sec.title}</div>
              <div className="tech-scroll">
                <div className="tech-rows-head" style={{ gridTemplateColumns: `repeat(${sec.cols.length}, minmax(96px,1fr))` }}>
                  {sec.cols.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                {Array.from({ length: sec.rows }).map((_, ri) => (
                  <div className="tech-rows-row" key={ri} style={{ gridTemplateColumns: `repeat(${sec.cols.length}, minmax(96px,1fr))` }}>
                    {sec.cols.map((col, ci) => {
                      const numeric = /\(kg\)|\(mv\)|\(Ω\)/i.test(col);
                      const gkey = `${sec.key}:${ri}:${ci}`;
                      const val = d.grids[gkey] ?? (sec.prefill?.[ri]?.[ci] || "");
                      return (
                        <input key={ci} className="tech-input" style={numeric ? { textAlign: "right" } : undefined} value={val} onChange={(e) => setGrid(gkey, e.target.value)} />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );

        return null;
      })}
      </div>
    </>
  );
}

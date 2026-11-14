"use client";

import { defaultStates } from "../lib/templates";
import { SectionBar, COAL, GOLD, INK, MUTE, PASS, FAIL, colorFor, weeklyVerdict } from "./ui";

/**
 * A sheet's own sections as the Workflow Reports app's form renders them:
 * square fields in two columns, each checklist as an Item | Result | Remarks
 * grid with result buttons (the remark box turns red when a line is flagged),
 * choices as coal/gold toggle buttons, the End–Middle–End runs with the live
 * verdict bar, the load-cell grid with its mV / Ω switch, and record grids.
 *
 * Controlled: the parent owns `data`.
 * data = { header:{client,site,weighbridge}, values:{}, checks:{}, runs:{}, grids:{} }
 */

const checkCols = (n) => `minmax(190px,1.1fr) ${n >= 3 ? 216 : 148}px minmax(240px,1.6fr)`;
const CHECK_TABLE_MINWIDTH = 760;
const cellBase = {
  padding: "8px 10px",
  borderRight: "1px solid #e6e0d2",
  borderBottom: "1px solid #e6e0d2",
  display: "flex",
  alignItems: "center",
};

function CheckHeader({ states }) {
  const th = {
    ...cellBase,
    background: COAL,
    color: "#fff",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: ".03em",
    textTransform: "uppercase",
    borderRightColor: "#2c2720",
    borderBottom: 0,
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: checkCols(states.length) }}>
      <span style={th}>Item</span>
      <span style={{ ...th, justifyContent: "center" }}>Result — {states.map((s) => s.label).join(" / ")}</span>
      <span style={{ ...th, borderRight: 0 }}>Remarks</span>
    </div>
  );
}

function CheckItem({ text, states, val, onChange }) {
  const active = val?.state;
  const isFlagged = active && active !== states[0].key;
  return (
    <div style={{ display: "grid", gridTemplateColumns: checkCols(states.length) }}>
      <span style={{ ...cellBase, fontSize: 14, color: INK }}>{text}</span>
      <div style={{ ...cellBase, gap: 6 }}>
        {states.map((s) => {
          const on = active === s.key;
          const col = colorFor(s.key);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange({ ...val, state: s.key })}
              style={{
                flex: 1,
                fontSize: 12,
                fontWeight: 800,
                padding: "8px 4px",
                borderRadius: 2,
                border: "1px solid",
                borderColor: on ? col : "#cfc8ba",
                background: on ? col : "#fff",
                color: on ? "#fff" : col,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              {on && (s.key === "ok" || s.key === "pass") && <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>✓</span>}
              {s.label}
            </button>
          );
        })}
      </div>
      <div style={{ ...cellBase, borderRight: 0 }}>
        <input
          className="input"
          spellCheck
          autoCapitalize="sentences"
          style={isFlagged ? { borderColor: FAIL, background: "#fdf1ef" } : undefined}
          placeholder={isFlagged ? "What needs attention — your supervisor will read it" : "Remark (optional)"}
          value={val?.remark || ""}
          onChange={(e) => onChange({ ...val, remark: e.target.value })}
        />
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input className="input" type={type} value={value || ""} placeholder={placeholder || ""} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function SheetFormFields({ template, data, onChange }) {
  const d = {
    header: data?.header || {},
    values: data?.values || {},
    checks: data?.checks || {},
    runs: data?.runs || {},
    grids: data?.grids || {},
  };
  const patch = (part, key, value) => onChange({ ...data, ...d, [part]: { ...d[part], [key]: value } });
  const setHeader = (k, v) => patch("header", k, v);
  const setValue = (k, v) => patch("values", k, v);
  const setRun = (k, v) => patch("runs", k, v);
  const setGrid = (k, v) => patch("grids", k, v);
  const setCheck = (k, next) => patch("checks", k, next);

  const isWeighing = template.category === "Weighing & Metrology";
  const verdict = weeklyVerdict(d.runs, d.values.limit);

  return (
    <>
      <div className="grid md-2">
        <Field label="Client (company)" value={d.header.client} onChange={(v) => setHeader("client", v)} placeholder="e.g. TATA Chemicals" />
        <Field label="Site / branch" value={d.header.site} onChange={(v) => setHeader("site", v)} placeholder="e.g. Magadi plant" />
      </div>
      {isWeighing && (
        <div style={{ maxWidth: 460 }}>
          <Field label="Weighbridge" value={d.header.weighbridge} onChange={(v) => setHeader("weighbridge", v)} placeholder="e.g. WB-4" />
        </div>
      )}

      {(template.sections || []).map((sec, si) => {
        if (sec.type === "fields")
          return (
            <div key={si} className="grid md-2">
              {sec.fields.map((f) => (
                <Field key={f.k} label={f.label} type={f.inputType || "text"} value={d.values[f.k]} onChange={(v) => setValue(f.k, v)} />
              ))}
            </div>
          );

        if (sec.type === "checklist") {
          const states = sec.states || defaultStates(sec.yes, sec.no);
          return (
            <div key={si}>
              <SectionBar>{sec.title}</SectionBar>
              <div style={{ overflowX: "auto" }}>
                <div className="card" style={{ minWidth: CHECK_TABLE_MINWIDTH, marginBottom: 8, overflow: "hidden" }}>
                  <CheckHeader states={states} />
                  {sec.items.map((it, ii) => (
                    <CheckItem
                      key={ii}
                      text={it}
                      states={states}
                      val={d.checks[`${si}:${ii}`]}
                      onChange={(v) => setCheck(`${si}:${ii}`, v)}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        }

        if (sec.type === "textarea")
          return (
            <div key={si}>
              <SectionBar>{sec.label}</SectionBar>
              <label className="field">
                <textarea className="input" rows={3} value={d.values[sec.k] || ""} onChange={(e) => setValue(sec.k, e.target.value)} spellCheck autoCapitalize="sentences" />
              </label>
            </div>
          );

        if (sec.type === "choices" && sec.dropdown)
          return (
            <div key={si}>
              <SectionBar>{sec.title}</SectionBar>
              <select className="input" value={d.values[sec.k] || ""} onChange={(e) => setValue(sec.k, e.target.value)} style={{ maxWidth: 420 }}>
                <option value="">Select…</option>
                {sec.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          );

        if (sec.type === "choices") {
          // Multi-select keeps the chosen options as a comma-joined string, in
          // template order, as the app does.
          const selected = sec.multi ? String(d.values[sec.k] || "").split(",").map((s) => s.trim()).filter(Boolean) : [];
          const isOn = (o) => (sec.multi ? selected.includes(o) : d.values[sec.k] === o);
          const toggle = (o) => {
            if (!sec.multi) return setValue(sec.k, o);
            const next = selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o];
            setValue(sec.k, sec.options.filter((x) => next.includes(x)).join(", "));
          };
          return (
            <div key={si}>
              <SectionBar>{sec.title}</SectionBar>
              {sec.multi && (
                <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                  Pick all that apply.
                </p>
              )}
              <div className="grid md-2">
                {sec.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => toggle(o)}
                    style={{
                      textAlign: "left",
                      fontSize: 14,
                      padding: "10px 12px",
                      borderRadius: 2,
                      border: "1px solid",
                      borderColor: isOn(o) ? COAL : "#cfc8ba",
                      background: isOn(o) ? COAL : "#fff",
                      color: isOn(o) ? GOLD : INK,
                      fontWeight: isOn(o) ? 700 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {sec.multi && <span style={{ marginRight: 8 }}>{isOn(o) ? "☑" : "☐"}</span>}
                    {o}
                  </button>
                ))}
              </div>
            </div>
          );
        }

        if (sec.type === "weekly")
          return (
            <div key={si}>
              <SectionBar>End — Middle — End test (same truck)</SectionBar>
              {[1, 2].map((r) => (
                <div key={r} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 1fr", gap: 8, marginBottom: 8, alignItems: "end", maxWidth: 560 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, paddingBottom: 10 }}>Run {r}</span>
                  {["a", "m", "b"].map((p, i) => (
                    <label key={p}>
                      <span style={{ fontSize: 11, color: MUTE }}>{["End A", "Middle", "End B"][i]} kg</span>
                      <input className="input" type="number" value={d.runs[`${r}${p}`] || ""} onChange={(e) => setRun(`${r}${p}`, e.target.value)} />
                    </label>
                  ))}
                </div>
              ))}
              {verdict.pass !== null && (
                <div style={{ padding: 12, borderRadius: 2, fontSize: 14, fontWeight: 700, color: "#fff", background: verdict.pass ? PASS : FAIL }}>
                  Biggest difference: {verdict.worst.toFixed(0)} kg (limit {verdict.limit} kg) —{" "}
                  {verdict.pass ? "GOOD. Keep using the weighbridge." : "OVER THE LIMIT. Stop trade weighing and call QSL."}
                </div>
              )}
            </div>
          );

        if (sec.type === "loadcells") {
          const unit = d.grids.lcUnit || "mV";
          const rows = [
            { key: "lc", label: unit === "ohm" ? "Impedance (Ω)" : "Output (mV)" },
            { key: "corner", label: "Corner (kg)" },
          ];
          return (
            <div key={si}>
              <SectionBar>Load cell readings</SectionBar>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: MUTE }}>Measure:</span>
                {[
                  { k: "mV", label: "Output (mV)" },
                  { k: "ohm", label: "Impedance (Ω)" },
                ].map((opt) => (
                  <button
                    key={opt.k}
                    type="button"
                    onClick={() => setGrid("lcUnit", opt.k)}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "6px 12px",
                      borderRadius: 2,
                      border: "1px solid",
                      borderColor: unit === opt.k ? COAL : "#cfc8ba",
                      background: unit === opt.k ? COAL : "#fff",
                      color: unit === opt.k ? GOLD : INK,
                      cursor: "pointer",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {rows.map((row) => (
                <div key={row.key} style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: MUTE }}>{row.label}</span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4, marginTop: 4 }}>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <input
                        key={i}
                        className="input"
                        type="number"
                        style={{ textAlign: "right" }}
                        placeholder={`#${i + 1}`}
                        value={d.grids[`${row.key}:${i}`] || ""}
                        onChange={(e) => setGrid(`${row.key}:${i}`, e.target.value)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        }

        if (sec.type === "rows")
          return (
            <div key={si}>
              <SectionBar>{sec.title}</SectionBar>
              <div style={{ overflowX: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${sec.cols.length}, minmax(90px,1fr))`, gap: 4, marginBottom: 4 }}>
                  {sec.cols.map((c) => (
                    <span key={c} style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: COAL, padding: "3px 4px" }}>
                      {c}
                    </span>
                  ))}
                </div>
                {Array.from({ length: sec.rows }).map((_, ri) => (
                  <div key={ri} style={{ display: "grid", gridTemplateColumns: `repeat(${sec.cols.length}, minmax(90px,1fr))`, gap: 4, marginBottom: 4 }}>
                    {sec.cols.map((col, ci) => {
                      const numeric = /\(kg\)|\(mv\)|\(Ω\)|\(mm\)|\(m\)|\(kn\)|\(mpa\)|\(bar\)|\(v\)|\(a\)|\(%\)|qty/i.test(col);
                      const gkey = `${sec.key}:${ri}:${ci}`;
                      return (
                        <input
                          key={ci}
                          className="input"
                          style={numeric ? { textAlign: "right" } : undefined}
                          value={d.grids[gkey] ?? (sec.prefill?.[ri]?.[ci] || "")}
                          onChange={(e) => setGrid(gkey, e.target.value)}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );

        return null;
      })}
    </>
  );
}

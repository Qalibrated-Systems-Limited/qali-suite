import { defaultStates, STATE_COLOR } from "../lib/templates";

/**
 * Read-only render of a saved sheet body on the report detail page — the same
 * sections SheetFormFields collects, shown back as a filled QSL form.
 */
function KV({ items }) {
  const shown = items.filter((i) => i.value != null && String(i.value).trim() !== "");
  if (!shown.length) return null;
  return (
    <div className="tech-kv">
      {shown.map((i) => (
        <div key={i.label}>
          <div className="k">{i.label}</div>
          <div className="v">{i.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function SheetDataView({ template, data }) {
  if (!template) return null;
  const d = {
    header: data?.header || {},
    values: data?.values || {},
    checks: data?.checks || {},
    runs: data?.runs || {},
    grids: data?.grids || {},
  };

  return (
    <div>
      <KV
        items={[
          { label: "Client (company)", value: d.header.client },
          { label: "Site / branch", value: d.header.site },
          { label: "Weighbridge", value: d.header.weighbridge },
        ]}
      />

      <div className="tech-sheet-flow" style={{ marginTop: 8 }}>
      {(template.sections || []).map((sec, si) => {
        if (sec.type === "fields")
          return (
            <div key={si} className="span-all" style={{ marginTop: 6 }}>
              <KV items={sec.fields.map((f) => ({ label: f.label, value: d.values[f.k] }))} />
            </div>
          );

        if (sec.type === "textarea") {
          const v = d.values[sec.k];
          if (!v || !String(v).trim()) return null;
          return (
            <div key={si}>
              <div className="tech-sectionbar">{sec.label}</div>
              <p className="tech-muted" style={{ fontSize: 14, whiteSpace: "pre-wrap", margin: 0 }}>{v}</p>
            </div>
          );
        }

        if (sec.type === "checklist") {
          const states = sec.states || defaultStates(sec.yes, sec.no);
          const byKey = Object.fromEntries(states.map((s) => [s.key, s.label]));
          return (
            <div key={si}>
              <div className="tech-sectionbar">{sec.title}</div>
              <div>
                {sec.items.map((it, ii) => {
                  const cur = d.checks[`${si}:${ii}`] || {};
                  const col = STATE_COLOR[cur.state] || "var(--tech-slate)";
                  return (
                    <div className="tech-ro-row" key={ii}>
                      <span className="lab">
                        {it}
                        {cur.remark ? (
                          <span className="tech-muted" style={{ display: "block", fontSize: 12 }}>↳ {cur.remark}</span>
                        ) : null}
                      </span>
                      {cur.state ? (
                        <span className="tech-ro-badge" style={{ background: col }}>{byKey[cur.state] || cur.state}</span>
                      ) : (
                        <span className="tech-muted" style={{ fontSize: 12, alignSelf: "center" }}>—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        if (sec.type === "choices") {
          const v = d.values[sec.k];
          if (!v) return null;
          return (
            <div key={si} style={{ marginTop: 12 }}>
              <KV items={[{ label: sec.title, value: v }]} />
            </div>
          );
        }

        if (sec.type === "weekly") {
          const has = [1, 2].some((r) => ["a", "m", "b"].some((p) => d.runs[`${r}${p}`]));
          if (!has) return null;
          return (
            <div key={si}>
              <div className="tech-sectionbar">End — Middle — End test</div>
              {[1, 2].map((r) => (
                <div key={r} className="tech-ro-row">
                  <span className="lab">Run {r}</span>
                  <span>End A {d.runs[`${r}a`] || "—"} · Middle {d.runs[`${r}m`] || "—"} · End B {d.runs[`${r}b`] || "—"} kg</span>
                </div>
              ))}
            </div>
          );
        }

        if (sec.type === "loadcells") {
          const unit = d.grids.lcUnit || "mV";
          const has = Array.from({ length: 8 }).some((_, i) => d.grids[`lc:${i}`] || d.grids[`corner:${i}`]);
          if (!has) return null;
          const readOut = (key) =>
            Array.from({ length: 8 })
              .map((_, i) => d.grids[`${key}:${i}`])
              .map((x, i) => (x ? `#${i + 1}:${x}` : null))
              .filter(Boolean)
              .join("  ");
          return (
            <div key={si}>
              <div className="tech-sectionbar">Load cell readings ({unit === "ohm" ? "Ω" : "mV"})</div>
              <div className="tech-ro-row"><span className="lab">Output / impedance</span><span>{readOut("lc") || "—"}</span></div>
              <div className="tech-ro-row"><span className="lab">Corner (kg)</span><span>{readOut("corner") || "—"}</span></div>
            </div>
          );
        }

        if (sec.type === "rows") {
          const rows = Array.from({ length: sec.rows }).map((_, ri) =>
            sec.cols.map((_c, ci) => d.grids[`${sec.key}:${ri}:${ci}`] ?? (sec.prefill?.[ri]?.[ci] || "")),
          );
          const has = rows.some((r) => r.some((c) => String(c).trim()));
          if (!has) return null;
          return (
            <div key={si} className="span-all">
              <div className="tech-sectionbar">{sec.title}</div>
              <div className="tech-scroll">
                <div className="tech-rows-head" style={{ gridTemplateColumns: `repeat(${sec.cols.length}, minmax(96px,1fr))` }}>
                  {sec.cols.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                {rows.map((r, ri) => (
                  <div className="tech-rows-row" key={ri} style={{ gridTemplateColumns: `repeat(${sec.cols.length}, minmax(96px,1fr))` }}>
                    {r.map((c, ci) => (
                      <span key={ci} style={{ fontSize: 13, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 4 }}>
                        {String(c).trim() || "—"}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        }

        return null;
      })}
      </div>
    </div>
  );
}

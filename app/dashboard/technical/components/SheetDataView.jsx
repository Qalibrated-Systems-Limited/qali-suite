import { defaultStates } from "../lib/templates";
import { SectionBar, COAL, INK, MUTE, PASS, FAIL, colorFor, weeklyVerdict } from "./ui";

/**
 * A saved sheet read back on the report page, as the Workflow Reports app's
 * report screen shows it: the filled fields as "LABEL: value" lines, then each
 * checklist as an Item | Result | Remarks table with solid result pills, the
 * grids as coal-headed tables, the weekly verdict as a green or red bar, and
 * the load-cell readings.
 */

const humanize = (k) => {
  const s = String(k)
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};

const CHECK_COLS = "minmax(190px,1.05fr) 96px minmax(240px,2fr)";

export default function SheetDataView({ template, data }) {
  if (!template) return null;
  const values = data?.values || {};
  const checks = data?.checks || {};
  const runs = data?.runs || {};
  const grids = data?.grids || {};

  const labels = {};
  const order = {};
  let oi = 0;
  (template.sections || []).forEach((sec) => {
    if (sec.type === "fields") sec.fields.forEach((f) => { labels[f.k] = f.label; order[f.k] = oi++; });
    else if (sec.type === "choices" && sec.k) { labels[sec.k] = sec.title; order[sec.k] = oi++; }
    else if (sec.type === "textarea" && sec.k) { labels[sec.k] = sec.label; order[sec.k] = oi++; }
  });
  const freeFields = Object.entries(values)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .sort((a, b) => (order[a[0]] ?? 999) - (order[b[0]] ?? 999));

  const hasRuns = [1, 2].some((r) => ["a", "m", "b"].some((p) => runs[`${r}${p}`]));

  return (
    <div>
      {freeFields.map(([k, v]) => (
        <div key={k} style={{ fontSize: 14, marginTop: 8, color: INK, whiteSpace: "pre-wrap" }}>
          <b style={{ textTransform: "uppercase", fontSize: 11, color: MUTE }}>{labels[k] || humanize(k)}: </b>
          {String(v)}
        </div>
      ))}

      {(template.sections || []).map((sec, si) => {
        if (sec.type === "checklist") {
          const states = sec.states || defaultStates(sec.yes, sec.no);
          return (
            <div key={si}>
              <SectionBar>{sec.title}</SectionBar>
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 480, maxWidth: 980, border: "1px solid #e6e0d2", borderRadius: 2, overflow: "hidden", background: "#fff" }}>
                  <div style={{ display: "grid", gridTemplateColumns: CHECK_COLS, background: COAL, color: "#fff", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>
                    <span style={{ padding: "6px 10px", borderRight: "1px solid #2c2720" }}>Item</span>
                    <span style={{ padding: "6px 10px", borderRight: "1px solid #2c2720", textAlign: "center" }}>Result</span>
                    <span style={{ padding: "6px 10px" }}>Remarks</span>
                  </div>
                  {sec.items.map((it, ii) => {
                    const v = checks[`${si}:${ii}`];
                    const st = states.find((x) => x.key === v?.state);
                    const isGood = st && st.key === states[0].key;
                    return (
                      <div key={ii} style={{ display: "grid", gridTemplateColumns: CHECK_COLS, fontSize: 14, borderTop: "1px solid #eae4d6" }}>
                        <span style={{ padding: "10px 12px", borderRight: "1px solid #eae4d6", color: INK, lineHeight: 1.35 }}>{it}</span>
                        <span style={{ padding: "10px 8px", borderRight: "1px solid #eae4d6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {st ? (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 10px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 800,
                                textTransform: "uppercase",
                                letterSpacing: ".02em",
                                color: "#fff",
                                background: colorFor(st.key),
                                textAlign: "center",
                                lineHeight: 1.3,
                              }}
                            >
                              {isGood ? "✓ " : ""}
                              {st.label}
                            </span>
                          ) : (
                            <span style={{ color: "#b8af9e" }}>—</span>
                          )}
                        </span>
                        <span style={{ padding: "10px 12px", color: v?.remark ? FAIL : MUTE, lineHeight: 1.35 }}>{v?.remark || "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        }

        if (sec.type === "rows") {
          const cells = [];
          for (let ri = 0; ri < (sec.rows || 4); ri++) {
            const row = sec.cols.map((_, ci) => grids[`${sec.key}:${ri}:${ci}`] ?? "");
            if (row.some((v) => String(v).trim() !== "")) cells.push(row);
          }
          const cols = `repeat(${sec.cols.length}, minmax(100px,1fr))`;
          return (
            <div key={si}>
              <SectionBar>{sec.title}</SectionBar>
              {cells.length ? (
                <div style={{ overflowX: "auto" }}>
                  <div style={{ minWidth: sec.cols.length * 110, border: "1px solid #e6e0d2", borderRadius: 2, overflow: "hidden", background: "#fff" }}>
                    <div style={{ display: "grid", gridTemplateColumns: cols, background: COAL, color: "#fff", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>
                      {sec.cols.map((c, ci) => (
                        <span key={ci} style={{ padding: "6px 10px", borderRight: ci < sec.cols.length - 1 ? "1px solid #2c2720" : "none" }}>{c}</span>
                      ))}
                    </div>
                    {cells.map((row, ri) => (
                      <div key={ri} style={{ display: "grid", gridTemplateColumns: cols, fontSize: 13.5, borderTop: "1px solid #eae4d6", background: ri % 2 ? "#FBF9F4" : "#fff" }}>
                        {row.map((v, ci) => (
                          <span key={ci} style={{ padding: "8px 10px", borderRight: ci < sec.cols.length - 1 ? "1px solid #eae4d6" : "none", color: INK }}>
                            {String(v) || "—"}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: MUTE, fontStyle: "italic" }}>Not recorded.</div>
              )}
            </div>
          );
        }

        if (sec.type === "loadcells") {
          const has = Array.from({ length: 8 }).some((_, i) => grids[`lc:${i}`] || grids[`corner:${i}`]);
          const unit = grids.lcUnit === "ohm" ? "Impedance (Ω)" : "Output (mV)";
          return (
            <div key={si}>
              <SectionBar>Load cell readings</SectionBar>
              {has ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 13, background: "#fff", minWidth: 560 }}>
                    <tbody>
                      {[
                        ["lc", unit],
                        ["corner", "Corner (kg)"],
                      ].map(([key, label]) => (
                        <tr key={key}>
                          <td style={{ padding: "6px 10px", border: "1px solid #e6e0d2", fontWeight: 800, background: "#F5EEDD", color: INK }}>{label}</td>
                          {Array.from({ length: 8 }).map((_, i) => (
                            <td key={i} style={{ padding: "6px 10px", border: "1px solid #e6e0d2", textAlign: "right", fontFamily: "var(--mono)" }}>
                              {grids[`${key}:${i}`] || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: MUTE, fontStyle: "italic" }}>Not recorded.</div>
              )}
            </div>
          );
        }

        if (sec.type === "weekly" && hasRuns) {
          const w = data?.weekly?.pass != null ? data.weekly : weeklyVerdict(runs, values.limit);
          const pass = w.pass;
          return (
            <div key={si}>
              <SectionBar>End — Middle — End test</SectionBar>
              <div className="mono" style={{ fontSize: 13, color: INK }}>
                {[1, 2].map((r) => `Run ${r}: ${runs[`${r}a`] || "—"} / ${runs[`${r}m`] || "—"} / ${runs[`${r}b`] || "—"} kg`).join("   ·   ")}
              </div>
              {pass != null && (
                <div style={{ padding: 10, marginTop: 10, borderRadius: 2, fontSize: 14, fontWeight: 700, color: "#fff", background: pass ? PASS : FAIL }}>
                  Weekly test: {pass ? "WITHIN LIMIT" : "OVER LIMIT — QSL attention required"} (limit {w.limit} kg)
                </div>
              )}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

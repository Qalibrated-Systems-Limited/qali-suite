// NOTE: no "use client" — this is rendered server-side inside the
// /api/technical/[id]/pdf route via renderToBuffer.
import React from "react";
import { Document, Page, Text, View, StyleSheet, Svg, Path } from "@react-pdf/renderer";
import { R, TopBar, RefinedHeader, TitlePill, RefinedFooter, VerifyQr, SectionHead, fmtEat } from "../refined";

// ============================================
// TECHNICAL REPORT PDF
// ============================================
// A port of the QSL Workflow Reports app's ReportDocument, so every sheet —
// the original weighbridge forms and the sheets added here for construction,
// civil, mechanical, electrical, QA/QC and HSE work — prints exactly as that
// app prints a report: refined letterhead, coal title pill with status, the
// continuous key/value info panel, the topic → response narrative table,
// checklists with one column per result state and a drawn tick, the load-cell
// and measurement grids, the approval trail, document control and printed
// sign-off where a sheet declares them, and the ISO footer with the
// "scan to verify" code.
//
// Mapped onto this module's record: the client / site / weighbridge come from
// the sheet header, the routed supervisor and manager from the named sign-off,
// and the trail from the report's own timestamps.
// ============================================

const { GOLD, COAL, INK, MUTE, PASS, FAIL } = R;

const STATUS = {
  draft: { label: "DRAFT", bg: MUTE, color: "#fff" },
  submitted: { label: "SUPERVISOR REVIEW", bg: GOLD, color: COAL },
  reviewed: { label: "MANAGER APPROVAL", bg: GOLD, color: COAL },
  approved: { label: "APPROVED", bg: PASS, color: "#fff" },
};

const s = StyleSheet.create({
  page: { paddingTop: 26, paddingBottom: 84, paddingHorizontal: 32, fontSize: 9, color: INK, fontFamily: "Helvetica" },
  table: { marginBottom: 6, borderTopWidth: 0.5, borderTopColor: "#E4DCCB" },
  row: { flexDirection: "row" },
  // The panel's rows carry the rule, and each label sits in a View so its
  // cream fill runs the full height of the row — a Text cell only stretches
  // to its own text, which left gaps in the rules where a value wrapped.
  panelRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E4DCCB" },
  keyBox: { backgroundColor: "#F7F4EC", paddingVertical: 4, paddingHorizontal: 7, width: "17%" },
  key: { fontFamily: "Helvetica-Bold", fontSize: 7, color: MUTE, letterSpacing: 0.3, textTransform: "uppercase" },
  val: { paddingVertical: 4, paddingHorizontal: 8, width: "33%", fontSize: 8.4, color: INK },
  fillCell: { width: "50%" },
  th: { backgroundColor: COAL, color: "#fff", fontSize: 7.5, padding: 2.5, fontFamily: "Helvetica-Bold" },
  td: { fontSize: 8, padding: 2.5, borderBottomWidth: 0.5, borderBottomColor: "#DDD" },
  tdCell: { fontSize: 8, padding: 2.5, borderWidth: 0.5, borderColor: "#DDD" },
  narrTable: { marginTop: 3, borderWidth: 0.5, borderColor: "#E4DCCB" },
  narrRow: { flexDirection: "row", alignItems: "stretch" },
  narrRowDiv: { borderTopWidth: 0.5, borderTopColor: "#E4DCCB" },
  narrKey: {
    width: "23%",
    backgroundColor: "#F5EEDD",
    padding: 4,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COAL,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    borderRightWidth: 0.5,
    borderRightColor: "#E4DCCB",
  },
  narrVal: { width: "77%", padding: 4 },
  narrText: { fontSize: 8.5, lineHeight: 1.35, color: INK },
  bulletRow: { flexDirection: "row", marginTop: 1 },
  bulletDot: { fontSize: 8.5, color: GOLD, width: 9, fontFamily: "Helvetica-Bold" },
  bulletText: { fontSize: 8.5, flex: 1, lineHeight: 1.3, color: INK },
  weekly: { marginTop: 8, padding: 6, borderWidth: 1, borderColor: "#111" },
  docCtrl: { marginTop: 10, borderWidth: 0.6, borderColor: "#C9C1B0", borderRadius: 3 },
  docCtrlHead: { backgroundColor: "#22201C", paddingVertical: 3, paddingHorizontal: 6 },
  docCtrlHeadText: { fontSize: 6.8, color: GOLD, fontFamily: "Helvetica-Bold", letterSpacing: 0.5, textTransform: "uppercase" },
  docCtrlBody: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 6, paddingTop: 6 },
  docCtrlItem: { width: "50%", flexDirection: "row", marginBottom: 3, paddingRight: 6 },
  docCtrlK: { fontSize: 6.8, fontFamily: "Helvetica-Bold", color: MUTE, width: 56, textTransform: "uppercase", letterSpacing: 0.3 },
  docCtrlV: { fontSize: 7.2, color: INK, flex: 1 },
  docCtrlNotice: { fontSize: 6.8, color: FAIL, fontFamily: "Helvetica-Bold", paddingHorizontal: 6, paddingBottom: 6, letterSpacing: 0.3 },
  signWrap: { marginTop: 12 },
  signStatement: { fontSize: 8, color: INK, lineHeight: 1.35, marginBottom: 8 },
  signCol: { flex: 1 },
  signColGap: { width: 14 },
  signTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COAL,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    backgroundColor: "#F5EEDD",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderWidth: 0.5,
    borderColor: "#E4DCCB",
  },
  signBody: { borderWidth: 0.5, borderTopWidth: 0, borderColor: "#E4DCCB", paddingTop: 4, paddingHorizontal: 6, paddingBottom: 6 },
  signField: { flexDirection: "row", alignItems: "flex-end", marginTop: 8 },
  signFieldK: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: MUTE, width: 58, textTransform: "uppercase", letterSpacing: 0.3 },
  signFieldLine: { flex: 1, borderBottomWidth: 0.7, borderBottomColor: "#8a8171", height: 11 },
});

// Right-aligned figures with a thousands separator; text is returned unchanged.
function fmtNum(v) {
  const str = String(v == null ? "" : v).trim();
  if (str === "") return "";
  const n = Number(str.replace(/,/g, ""));
  return Number.isNaN(n) ? str : n.toLocaleString("en-US");
}

// A grid column is right-aligned when everything recorded in it is a number —
// the app keyed this on the column name, which only knew the weighbridge grids.
const isNum = (v) => String(v ?? "").trim() !== "" && !Number.isNaN(Number(String(v).replace(/,/g, "")));
function numericColumns(sec, grids) {
  return sec.cols.map((_, ci) => {
    const cells = Array.from({ length: sec.rows })
      .map((__, ri) => grids[`${sec.key}:${ri}:${ci}`])
      .filter((v) => String(v ?? "").trim() !== "");
    return cells.length > 0 && cells.every(isNum);
  });
}

function Cell({ children, style }) {
  return <Text style={[s.td, style]}>{children}</Text>;
}

// Helvetica has no check-mark glyph, so the tick is drawn.
function Tick() {
  return (
    <Svg width={9} height={9} viewBox="0 0 12 12">
      <Path d="M1.5 6.5 L4.5 9.5 L10.5 2.5" stroke={PASS} strokeWidth={2} fill="none" />
    </Svg>
  );
}

function defaultStates(yes = "OK", no = "NO") {
  return [
    { key: "ok", label: yes },
    { key: "problem", label: no },
  ];
}

const humanize = (k) =>
  String(k)
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

/** The trail the app keeps as events, rebuilt from this record's timestamps. */
function trailOf(report) {
  return [
    ["Created", report.createdByName, report.createdAt],
    ["Submitted for review", report.submittedByName, report.submittedAt],
    ["Supervisor signed off", report.reviewedByName, report.reviewedAt],
    ["Approved", report.approvedByName, report.approvedAt],
  ]
    .concat(
      report.data?.returned
        ? [[`Returned to author — "${report.data.returned.comment}"`, report.data.returned.byName, report.data.returned.at]]
        : [],
    )
    .filter(([, , at]) => at)
    .sort((a, b) => new Date(a[2]) - new Date(b[2]))
    .map(([action, byName, at]) => ({ action, byName: byName || "—", at }));
}

export function TechnicalReportPDF({ report, project, company = {}, template, sheetLabel, serial, qrSrc }) {
  const tpl = template;
  const data = report.data || {};
  const header = data.header || {};
  const values = data.values || {};
  const grids = data.grids || {};
  const runs = data.runs || {};
  const st = STATUS[report.status] || STATUS.draft;
  const serviceDate = report.periodStart || report.submittedAt || report.createdAt;

  // What the info panel's second row says depends on the kind of work: a
  // weighbridge sheet names the weighbridge, a field-service report the
  // vehicle, everything else the project it was filed against.
  const isWeighing = tpl?.category === "Weighing & Metrology";
  const isTechReport = report.type === "TR01";
  const reportTypeVal = `${tpl?.category || "Report"} (${report.type})`;
  const projectVal = project ? `${project.projectNumber} · ${project.name}` : "—";
  const meta = [
    ["Client", header.client || "—", "Site", header.site || "—"],
    isTechReport
      ? ["Vehicle no.", values.vehicleNo || "—", "Report type", reportTypeVal]
      : isWeighing
        ? ["Weighbridge", header.weighbridge || "—", "Report type", reportTypeVal]
        : ["Project", projectVal, "Report type", reportTypeVal],
    ["Completed by", report.createdByName || "—", "Date", fmtEat(serviceDate)],
    ["Supervisor", report.assignedReviewerName || report.reviewedByName || "—", "Manager", report.assignedApproverName || report.approvedByName || "—"],
  ];
  if (isTechReport || isWeighing) meta.push(["Project", projectVal, "", ""]);

  const sections = tpl?.sections || [];
  const fieldLabels = {};
  const longKeys = new Set();
  const fieldOrder = {};
  let oi = 0;
  sections.forEach((sec) => {
    if (sec.type === "fields") sec.fields.forEach((f) => { fieldLabels[f.k] = f.label; fieldOrder[f.k] = oi++; });
    else if (sec.type === "choices") { fieldLabels[sec.k] = sec.title; fieldOrder[sec.k] = oi++; }
    else if (sec.type === "textarea") { fieldLabels[sec.k] = sec.label; longKeys.add(sec.k); fieldOrder[sec.k] = oi++; }
  });
  const labelFor = (k) => fieldLabels[k] || humanize(k);

  const show = (v) => (Array.isArray(v) ? v.join(", ") : v);
  let freeFields = Object.entries(values)
    .filter(([k, v]) => k !== "weighbridgeId" && !(isTechReport && k === "vehicleNo") && v != null && String(show(v)).trim() !== "")
    .sort((a, b) => (fieldOrder[a[0]] ?? 999) - (fieldOrder[b[0]] ?? 999));
  // A report filed without a sheet (the older free-text form) prints its
  // narrative through the same table.
  if (!tpl) {
    freeFields = [
      ["summary", report.summary],
      ["workCompleted", report.workCompleted],
      ["issues", report.issues],
      ["nextSteps", report.nextSteps],
    ].filter(([, v]) => v && String(v).trim());
    Object.assign(fieldLabels, {
      summary: "Summary",
      workCompleted: "Work completed / findings",
      issues: "Issues & faults",
      nextSteps: "Next steps / parts",
    });
    freeFields.forEach(([k]) => longKeys.add(k));
  }
  const detailFields = freeFields.filter(([k]) => !longKeys.has(k));
  const narrativeFields = freeFields.filter(([k]) => longKeys.has(k));
  const detailRows = [];
  for (let i = 0; i < detailFields.length; i += 2) detailRows.push(detailFields.slice(i, i + 2));

  const checklistSections = sections.map((sec, idx) => ({ sec, idx })).filter(({ sec }) => sec.type === "checklist");
  const rowSections = sections.filter((sec) => sec.type === "rows");
  const hasLoadcells = sections.some((sec) => sec.type === "loadcells");
  const hasWeekly = sections.some((sec) => sec.type === "weekly") && [1, 2].some((r) => ["a", "m", "b"].some((p) => runs[`${r}${p}`]));
  // Helvetica has no omega, so spell out "Ohm".
  const lcRows = [
    { key: "lc", label: grids.lcUnit === "ohm" ? "Impedance (Ohm)" : "Output (mV)" },
    { key: "corner", label: "Corner (kg)" },
  ];
  const trail = trailOf(report);
  // The verdict as the form works it out: the biggest spread across a run
  // against the site's limit — computed here too for reports saved before the
  // form stored it.
  const weekly = (() => {
    if (data.weekly?.pass != null) return data.weekly;
    const diffs = [1, 2].map((r) => {
      const nums = ["a", "m", "b"].map((p) => parseFloat(runs[`${r}${p}`]));
      return nums.some((n) => Number.isNaN(n)) ? null : Math.max(...nums) - Math.min(...nums);
    });
    const limit = parseFloat(values.limit);
    const worst = Math.max(...diffs.map((d) => (d == null ? 0 : d)));
    return {
      pass: diffs.every((d) => d == null) || Number.isNaN(limit) ? null : worst <= limit,
      limit: Number.isNaN(limit) ? null : limit,
    };
  })();

  return (
    <Document title={`${sheetLabel || "Report"} ${serial}`}>
      <Page size="A4" style={s.page} wrap>
        <TopBar kind="report" />
        <RefinedHeader
          company={company}
          meta={[
            { k: "Date", v: fmtEat(serviceDate) },
            { k: "No.", v: serial, mono: true },
          ]}
        />

        <TitlePill title={sheetLabel || report.title} status={st} />

        {/* Info panel — meta and short fields in one continuous key/value table. */}
        <View style={s.table}>
          {meta.map((r, i) => (
            <View style={s.panelRow} key={`m${i}`} wrap={false}>
              <View style={s.keyBox}>
                <Text style={s.key}>{r[0]}</Text>
              </View>
              <Text style={s.val}>{r[1]}</Text>
              {r[2] ? (
                <>
                  <View style={s.keyBox}>
                    <Text style={s.key}>{r[2]}</Text>
                  </View>
                  <Text style={s.val}>{r[3]}</Text>
                </>
              ) : (
                <View style={s.fillCell} />
              )}
            </View>
          ))}
          {detailRows.map((pair, ri) => (
            <View style={s.panelRow} key={`d${ri}`} wrap={false}>
              {[0, 1].map((ci) => {
                const cell = pair[ci];
                if (!cell) return <View key={ci} style={s.fillCell} />;
                return (
                  <React.Fragment key={ci}>
                    <View style={s.keyBox}>
                      <Text style={s.key}>{labelFor(cell[0])}</Text>
                    </View>
                    <Text style={s.val}>{String(show(cell[1]))}</Text>
                  </React.Fragment>
                );
              })}
            </View>
          ))}
        </View>

        {/* Narrative — topic on the left, response on the right; dash lines become bullets. */}
        {narrativeFields.length > 0 && (
          <View>
            <SectionHead>{isTechReport ? "Job details" : "Details"}</SectionHead>
            <View style={s.narrTable}>
              {narrativeFields.map(([k, v], ri) => {
                const lines = String(v).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                const bulleted = lines.length > 1 && lines.every((l) => /^[-•*]/.test(l));
                return (
                  <View style={[s.narrRow, ri > 0 && s.narrRowDiv]} key={k} wrap={false}>
                    <Text style={s.narrKey}>{labelFor(k)}</Text>
                    <View style={s.narrVal}>
                      {bulleted ? (
                        lines.map((l, i) => (
                          <View style={s.bulletRow} key={i}>
                            <Text style={s.bulletDot}>•</Text>
                            <Text style={s.bulletText}>{l.replace(/^[-•*]\s*/, "")}</Text>
                          </View>
                        ))
                      ) : (
                        <Text style={s.narrText}>{String(v)}</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Checklists — one result column per state, a drawn tick for the good one. */}
        {checklistSections.map(({ sec, idx }) => {
          const states = sec.states || defaultStates(sec.yes, sec.no);
          const stateW = `${(12 / states.length).toFixed(2)}%`;
          const itemW = "44%";
          const remarksW = "44%";
          const tickKeys = new Set(["ok", "pass"]);
          const vline = { borderRightWidth: 0.5, borderColor: "#AFAFAF" };
          return (
            <View key={idx} wrap={false}>
              <SectionHead>{sec.title}</SectionHead>
              <View style={{ borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: "#AFAFAF" }}>
                <View style={s.row}>
                  <Text style={[s.th, vline, { width: itemW }]}>ITEM</Text>
                  {states.map((x) => (
                    <Text key={x.key} style={[s.th, vline, { width: stateW, textAlign: "center" }]}>{x.label}</Text>
                  ))}
                  <Text style={[s.th, vline, { width: remarksW }]}>REMARKS</Text>
                </View>
                {sec.items.map((it, ii) => {
                  const v = data.checks?.[`${idx}:${ii}`];
                  return (
                    <View style={s.row} key={ii}>
                      <Cell style={[vline, { fontSize: 7.5, width: itemW }]}>{it}</Cell>
                      {states.map((x) => (
                        <View key={x.key} style={[s.td, vline, { width: stateW, alignItems: "center", justifyContent: "center" }]}>
                          {v?.state === x.key ? tickKeys.has(x.key) ? <Tick /> : <Text>X</Text> : null}
                        </View>
                      ))}
                      <Cell style={[vline, { width: remarksW, color: FAIL }]}>{v?.remark || ""}</Cell>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

        {/* Weekly End-Middle-End verdict. */}
        {hasWeekly && (
          <View style={s.weekly} wrap={false}>
            <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold" }}>
              WEEKLY END-MIDDLE-END TEST:{" "}
              {weekly.pass == null ? "not completed" : weekly.pass ? "WITHIN LIMIT" : "OVER LIMIT - QSL ATTENTION REQUIRED"} (limit{" "}
              {fmtNum(weekly.limit) || "-"} kg)
            </Text>
            <Text style={{ fontSize: 8, marginTop: 2, fontFamily: "Courier" }}>
              Runs:{" "}
              {["1", "2"]
                .map((r) => `[${fmtNum(runs[r + "a"]) || "-"} / ${fmtNum(runs[r + "m"]) || "-"} / ${fmtNum(runs[r + "b"]) || "-"}]`)
                .join("   ")}
            </Text>
          </View>
        )}

        {/* Load cell readings. */}
        {hasLoadcells && (
          <View wrap={false} style={{ marginTop: 4 }}>
            <SectionHead>Load cell readings</SectionHead>
            {lcRows.map((row) => (
              <View style={s.row} key={row.key}>
                <Text style={[s.tdCell, { width: "20%", fontFamily: "Helvetica-Bold", backgroundColor: "#F5EEDD" }]}>{row.label}</Text>
                {Array.from({ length: 8 }).map((_, i) => (
                  <Text style={[s.tdCell, { width: "10%", textAlign: "right" }]} key={i}>
                    {fmtNum(grids[`${row.key}:${i}`])}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* Measurement / record grids. */}
        {rowSections.map((sec, si) => {
          const w = `${(100 / sec.cols.length).toFixed(2)}%`;
          const numeric = numericColumns(sec, grids);
          return (
            <View key={si} wrap={false} style={{ marginTop: 4 }}>
              <SectionHead>{sec.title}</SectionHead>
              <View style={s.row}>
                {sec.cols.map((c, ci) => (
                  <Text style={[s.th, { width: w, textAlign: numeric[ci] ? "right" : "left" }]} key={c}>{c}</Text>
                ))}
              </View>
              {Array.from({ length: sec.rows }).map((_, ri) => (
                <View style={s.row} key={ri}>
                  {sec.cols.map((_c, ci) => {
                    const raw = grids[`${sec.key}:${ri}:${ci}`] ?? (sec.prefill?.[ri]?.[ci] || "");
                    return (
                      <Text style={[s.tdCell, { width: w, textAlign: numeric[ci] ? "right" : "left" }]} key={ci}>
                        {numeric[ci] ? fmtNum(raw) : String(raw)}
                      </Text>
                    );
                  })}
                </View>
              ))}
            </View>
          );
        })}

        {/* Approval trail. */}
        <View wrap={false}>
          <SectionHead>Approval trail</SectionHead>
          <View style={s.row}>
            <Text style={[s.th, { width: "50%" }]}>ACTION</Text>
            <Text style={[s.th, { width: "28%" }]}>BY</Text>
            <Text style={[s.th, { width: "22%" }]}>DATE / TIME</Text>
          </View>
          {trail.map((t, i) => (
            <View style={s.row} key={i}>
              <Cell style={{ width: "50%" }}>{t.action}</Cell>
              <Cell style={{ width: "28%" }}>{t.byName}</Cell>
              <Cell style={{ width: "22%" }}>{fmtEat(t.at)}</Cell>
            </View>
          ))}
          {report.status === "submitted" && report.assignedReviewerName ? (
            <View style={s.row}>
              <Cell style={{ width: "50%", color: MUTE }}>Awaiting supervisor sign-off</Cell>
              <Cell style={{ width: "28%", color: MUTE }}>{report.assignedReviewerName}</Cell>
              <Cell style={{ width: "22%" }}> </Cell>
            </View>
          ) : null}
          {(report.status === "submitted" || report.status === "reviewed") && report.assignedApproverName ? (
            <View style={s.row}>
              <Cell style={{ width: "50%", color: MUTE }}>Awaiting manager approval</Cell>
              <Cell style={{ width: "28%", color: MUTE }}>{report.assignedApproverName}</Cell>
              <Cell style={{ width: "22%" }}> </Cell>
            </View>
          ) : null}
        </View>

        {/* ISO document control, where the sheet declares it. */}
        {tpl?.docControl ? (
          <View style={s.docCtrl} wrap={false}>
            <View style={s.docCtrlHead}>
              <Text style={s.docCtrlHeadText}>Document control</Text>
            </View>
            <View style={s.docCtrlBody}>
              <View style={[s.docCtrlItem, { width: "100%" }]}>
                <Text style={s.docCtrlK}>Reference</Text>
                <Text style={s.docCtrlV}>{tpl.docControl.reference}</Text>
              </View>
              <View style={s.docCtrlItem}>
                <Text style={s.docCtrlK}>Doc no.</Text>
                <Text style={s.docCtrlV}>{tpl.docControl.docNo}</Text>
              </View>
              <View style={s.docCtrlItem}>
                <Text style={s.docCtrlK}>{tpl.docControl.serialLabel || "Serial no."}</Text>
                <Text style={s.docCtrlV}>{serial}</Text>
              </View>
              <View style={s.docCtrlItem}>
                <Text style={s.docCtrlK}>Revision</Text>
                <Text style={s.docCtrlV}>{tpl.docControl.revision}</Text>
              </View>
              <View style={s.docCtrlItem}>
                <Text style={s.docCtrlK}>Issue date</Text>
                <Text style={s.docCtrlV}>{tpl.docControl.issueDate}</Text>
              </View>
            </View>
            {tpl.docControl.notice ? <Text style={s.docCtrlNotice}>{tpl.docControl.notice}</Text> : null}
          </View>
        ) : null}

        {/* Printed wet-signature sign-off, where the sheet declares it. */}
        {tpl?.signOff ? (
          <View style={s.signWrap} wrap={false}>
            <SectionHead>{tpl.signOff.title || "Sign-off"}</SectionHead>
            {tpl.signOff.statement ? <Text style={s.signStatement}>{tpl.signOff.statement}</Text> : null}
            <View style={s.row}>
              {(tpl.signOff.parties || []).map((party, pi) => (
                <React.Fragment key={pi}>
                  {pi > 0 ? <View style={s.signColGap} /> : null}
                  <View style={s.signCol}>
                    <Text style={s.signTitle}>{party}</Text>
                    <View style={s.signBody}>
                      {(tpl.signOff.lines || ["Name", "Signature", "Date"]).map((ln, li) => (
                        <View style={s.signField} key={li}>
                          <Text style={s.signFieldK}>{ln}</Text>
                          <View style={s.signFieldLine} />
                        </View>
                      ))}
                    </View>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </View>
        ) : null}

        <VerifyQr qrSrc={qrSrc} />
        <RefinedFooter
          company={company}
          serial={serial}
          note={
            tpl?.signOff
              ? null
              : "System-generated document — no physical signature required. Approvals are captured electronically and recorded in the approval trail."
          }
        />
      </Page>
    </Document>
  );
}

export default TechnicalReportPDF;

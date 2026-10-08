// NOTE: no "use client" — this is rendered server-side inside the
// /api/technical/[id]/pdf route via renderToBuffer, the same pattern as
// GoodsReceiptPDF / PayslipDocument, so it must be a plain server module.
import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { formatDate, formatAddress } from "../utils";

// ============================================
// TECHNICAL REPORT PDF
// ============================================
// One printable QSL field-service / inspection report. Shares the house PDF
// theme used by Invoice / GRN / Delivery Note: gold primary, dark text, a logo
// header, a gold rule under the title, info cards, a state-coloured body and a
// sign-off / review trail at the foot.
//
// Renders the saved sheet body (data.header / values / checks / runs / grids)
// through the same section grammar as SheetDataView, so the PDF and the on-
// screen report cannot disagree about what the sheet says.
// ============================================

const colors = {
  primary: "#eab308",
  primaryLight: "#fef3c7",
  dark: "#18181b",
  gray: "#71717a",
  grayLight: "#d4d4d8",
  grayLightest: "#f4f4f5",
  white: "#ffffff",
  green: "#16a34a",
  amber: "#d97706",
  slate: "#64748b",
  red: "#dc2626",
};

// Result-state pill colours (mirror templates.js STATE_COLOR, in hex).
const STATE_HEX = {
  ok: colors.green,
  pass: colors.green,
  attn: colors.amber,
  adj: colors.amber,
  na: colors.slate,
  problem: colors.red,
  fail: colors.red,
};

// Status badge palette by workflow state.
const STATUS_BADGE = {
  draft: { bg: colors.grayLightest, fg: colors.gray },
  submitted: { bg: colors.primaryLight, fg: colors.amber },
  reviewed: { bg: colors.primaryLight, fg: colors.amber },
  approved: { bg: "#dcfce7", fg: colors.green },
};

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: 40, backgroundColor: colors.white, color: colors.dark },

  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  logoSection: { flex: 1 },
  logo: { width: 140, height: 45, objectFit: "contain", marginBottom: 6 },
  companyDetails: { fontSize: 8, color: colors.gray, lineHeight: 1.4 },
  companyTagline: { fontSize: 8, fontFamily: "Helvetica-Oblique", color: colors.primary, marginTop: 4 },
  docHead: { alignItems: "flex-end" },
  docTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", color: colors.primary },
  docNumber: { fontSize: 10, fontFamily: "Helvetica-Bold", color: colors.dark, marginTop: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3, marginTop: 6 },
  statusText: { fontSize: 7, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },

  divider: { height: 2, backgroundColor: colors.primary, marginBottom: 16 },

  reportTitle: { fontSize: 15, fontFamily: "Helvetica-Bold", color: colors.dark, marginBottom: 10 },

  infoRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  infoCard: { flex: 1, backgroundColor: colors.grayLightest, padding: 10, borderRadius: 4 },
  infoLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: colors.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  infoText: { fontSize: 9, color: colors.dark, lineHeight: 1.4 },
  infoTextBold: { fontSize: 9, fontFamily: "Helvetica-Bold", color: colors.dark },

  // Section bar (gold-accented heading)
  sectionBar: {
    fontSize: 9, fontFamily: "Helvetica-Bold", color: colors.dark, textTransform: "uppercase", letterSpacing: 0.4,
    borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 6, marginTop: 14, marginBottom: 8,
  },

  // Key/value grid
  kvWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kvItem: { width: "48%", marginBottom: 6 },
  kvKey: { fontSize: 7, color: colors.gray, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 2 },
  kvVal: { fontSize: 9.5, color: colors.dark },

  para: { fontSize: 9.5, color: colors.dark, lineHeight: 1.5 },

  // Checklist rows
  checkRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: colors.grayLight },
  checkLabel: { fontSize: 9, color: colors.dark, flex: 1, paddingRight: 8 },
  checkRemark: { fontSize: 8, color: colors.gray },
  statePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, color: colors.white, fontSize: 7, fontFamily: "Helvetica-Bold" },
  dash: { fontSize: 9, color: colors.gray },

  // Table (rows / loadcells)
  thRow: { flexDirection: "row", backgroundColor: colors.dark, paddingVertical: 5, paddingHorizontal: 2 },
  th: { color: colors.white, fontSize: 7.5, fontFamily: "Helvetica-Bold", textTransform: "uppercase", paddingHorizontal: 3 },
  tdRow: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 2, borderBottomWidth: 0.5, borderBottomColor: colors.grayLight },
  td: { fontSize: 8.5, color: colors.dark, paddingHorizontal: 3 },

  // Snapshot
  snapRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  snapLabel: { fontSize: 9, color: colors.gray },
  snapValue: { fontSize: 9, fontFamily: "Helvetica-Bold", color: colors.dark },
  barTrack: { height: 7, backgroundColor: colors.grayLightest, borderRadius: 6, marginTop: 4, overflow: "hidden" },
  barFill: { height: 7, backgroundColor: colors.primary, borderRadius: 6 },

  // Sign-off boxes
  signoffRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  signoffBox: { width: "47%", borderWidth: 1, borderColor: colors.grayLight, borderRadius: 4, padding: 10, minHeight: 58 },
  signoffLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: colors.gray, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 },
  signoffName: { fontSize: 10, fontFamily: "Helvetica-Bold", color: colors.dark },
  signoffDate: { fontSize: 8, color: colors.gray, marginTop: 2 },
  signoffPending: { fontSize: 9, color: colors.gray, fontFamily: "Helvetica-Oblique" },

  footer: { position: "absolute", bottom: 24, left: 40, right: 40, borderTopWidth: 1, borderTopColor: colors.grayLight, paddingTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerMotto: { fontSize: 8, color: colors.primary, fontFamily: "Helvetica-Bold" },
  footerText: { fontSize: 7, color: colors.gray },
});

function KV({ items }) {
  const shown = items.filter((i) => i.value != null && String(i.value).trim() !== "");
  if (!shown.length) return null;
  return (
    <View style={s.kvWrap}>
      {shown.map((i, idx) => (
        <View key={idx} style={s.kvItem}>
          <Text style={s.kvKey}>{i.label}</Text>
          <Text style={s.kvVal}>{String(i.value)}</Text>
        </View>
      ))}
    </View>
  );
}

function Table({ cols, rows }) {
  const w = `${100 / cols.length}%`;
  return (
    <View>
      <View style={s.thRow}>
        {cols.map((c, i) => (
          <Text key={i} style={[s.th, { width: w }]}>{c}</Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={s.tdRow}>
          {r.map((c, ci) => (
            <Text key={ci} style={[s.td, { width: w }]}>{String(c).trim() || "—"}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

// Default OK/problem states when a checklist doesn't declare its own.
function defaultStates(yes = "OK", no = "NO") {
  return [
    { key: "ok", label: yes },
    { key: "problem", label: no },
  ];
}

function SheetBody({ template, data }) {
  if (!template) return null;
  const d = {
    header: data?.header || {},
    values: data?.values || {},
    checks: data?.checks || {},
    runs: data?.runs || {},
    grids: data?.grids || {},
  };

  return (
    <View>
      <KV
        items={[
          { label: "Client (company)", value: d.header.client },
          { label: "Site / branch", value: d.header.site },
          { label: "Weighbridge", value: d.header.weighbridge },
        ]}
      />

      {(template.sections || []).map((sec, si) => {
        if (sec.type === "fields") {
          return (
            <View key={si} style={{ marginTop: 8 }} wrap={false}>
              <KV items={sec.fields.map((f) => ({ label: f.label, value: d.values[f.k] }))} />
            </View>
          );
        }

        if (sec.type === "textarea") {
          const v = d.values[sec.k];
          if (!v || !String(v).trim()) return null;
          return (
            <View key={si} wrap={false}>
              <Text style={s.sectionBar}>{sec.label}</Text>
              <Text style={s.para}>{String(v)}</Text>
            </View>
          );
        }

        if (sec.type === "checklist") {
          const states = sec.states || defaultStates(sec.yes, sec.no);
          const byKey = Object.fromEntries(states.map((st) => [st.key, st.label]));
          return (
            <View key={si}>
              <Text style={s.sectionBar}>{sec.title}</Text>
              {sec.items.map((it, ii) => {
                const cur = d.checks[`${si}:${ii}`] || {};
                const col = STATE_HEX[cur.state] || colors.slate;
                return (
                  <View key={ii} style={s.checkRow} wrap={false}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={s.checkLabel}>{it}</Text>
                      {cur.remark ? <Text style={s.checkRemark}>↳ {cur.remark}</Text> : null}
                    </View>
                    {cur.state ? (
                      <Text style={[s.statePill, { backgroundColor: col }]}>{byKey[cur.state] || cur.state}</Text>
                    ) : (
                      <Text style={s.dash}>—</Text>
                    )}
                  </View>
                );
              })}
            </View>
          );
        }

        if (sec.type === "choices") {
          const v = d.values[sec.k];
          if (!v) return null;
          return (
            <View key={si} style={{ marginTop: 10 }} wrap={false}>
              <KV items={[{ label: sec.title, value: v }]} />
            </View>
          );
        }

        if (sec.type === "weekly") {
          const has = [1, 2].some((r) => ["a", "m", "b"].some((p) => d.runs[`${r}${p}`]));
          if (!has) return null;
          return (
            <View key={si} wrap={false}>
              <Text style={s.sectionBar}>End — Middle — End test</Text>
              <Table
                cols={["Run", "End A (kg)", "Middle (kg)", "End B (kg)"]}
                rows={[1, 2].map((r) => [`Run ${r}`, d.runs[`${r}a`] || "—", d.runs[`${r}m`] || "—", d.runs[`${r}b`] || "—"])}
              />
            </View>
          );
        }

        if (sec.type === "loadcells") {
          const unit = d.grids.lcUnit === "ohm" ? "Ω" : "mV";
          const has = Array.from({ length: 8 }).some((_, i) => d.grids[`lc:${i}`] || d.grids[`corner:${i}`]);
          if (!has) return null;
          const rows = Array.from({ length: 8 })
            .map((_, i) => [`#${i + 1}`, d.grids[`lc:${i}`] || "—", d.grids[`corner:${i}`] || "—"])
            .filter((r) => r[1] !== "—" || r[2] !== "—");
          return (
            <View key={si} wrap={false}>
              <Text style={s.sectionBar}>Load cell readings</Text>
              <Table cols={["Cell", `Output (${unit})`, "Corner (kg)"]} rows={rows} />
            </View>
          );
        }

        if (sec.type === "rows") {
          const rows = Array.from({ length: sec.rows }).map((_, ri) =>
            sec.cols.map((_c, ci) => d.grids[`${sec.key}:${ri}:${ci}`] ?? (sec.prefill?.[ri]?.[ci] || "")),
          );
          const has = rows.some((r) => r.some((c) => String(c).trim()));
          if (!has) return null;
          return (
            <View key={si} wrap={false}>
              <Text style={s.sectionBar}>{sec.title}</Text>
              <Table cols={sec.cols} rows={rows.filter((r) => r.some((c) => String(c).trim()))} />
            </View>
          );
        }

        return null;
      })}
    </View>
  );
}

function Narrative({ report }) {
  const blocks = [
    ["Summary", report.summary],
    ["Work completed / findings", report.workCompleted],
    ["Issues & faults", report.issues],
    ["Next steps / parts", report.nextSteps],
  ].filter(([, v]) => v && String(v).trim());
  return (
    <View>
      {report.periodStart || report.periodEnd ? (
        <Text style={[s.para, { marginBottom: 8 }]}>
          Reporting period: {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
        </Text>
      ) : null}
      {blocks.map(([label, v]) => (
        <View key={label} wrap={false}>
          <Text style={s.sectionBar}>{label}</Text>
          <Text style={s.para}>{String(v)}</Text>
        </View>
      ))}
    </View>
  );
}

function SignoffBox({ label, name, when }) {
  return (
    <View style={s.signoffBox}>
      <Text style={s.signoffLabel}>{label}</Text>
      {name || when ? (
        <>
          <Text style={s.signoffName}>{name || "—"}</Text>
          <Text style={s.signoffDate}>{when ? formatDate(when) : ""}</Text>
        </>
      ) : (
        <Text style={s.signoffPending}>Pending</Text>
      )}
    </View>
  );
}

export function TechnicalReportPDF({ report, project, company = {}, template, sheetLabel, serial, statusLabel }) {
  const badge = STATUS_BADGE[report.status] || STATUS_BADGE.draft;
  const hasSnapshot =
    report.snapshotProgress != null || report.snapshotRevenue != null || report.snapshotCost != null;
  const money = (n) =>
    n == null ? "—" : `KES ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.logoSection}>
            {/* Logo may be a string, an object ({url,publicId}) or absent. */}
            {typeof company?.logo === "string" && company.logo ? (
              <Image style={s.logo} src={company.logo} />
            ) : company?.logo?.url ? (
              <Image style={s.logo} src={company.logo.url} />
            ) : (
              <Text style={s.infoTextBold}>{company?.name || "Qalibrated Systems Ltd"}</Text>
            )}
            {/* Address may be a string or a structured object — flatten it. */}
            <Text style={s.companyDetails}>
              {company?.name || "Qalibrated Systems Ltd"}
              {formatAddress(company?.address) ? `\n${formatAddress(company.address)}` : ""}
              {company?.phone || company?.email ? `\n${[company.phone, company.email].filter(Boolean).join(" | ")}` : ""}
              {company?.taxPin ? `\nPIN: ${company.taxPin}` : ""}
            </Text>
            {company?.tagline ? <Text style={s.companyTagline}>{company.tagline}</Text> : null}
          </View>
          <View style={s.docHead}>
            <Text style={s.docTitle}>TECHNICAL REPORT</Text>
            <Text style={s.docNumber}>{serial}</Text>
            <View style={[s.statusBadge, { backgroundColor: badge.bg }]}>
              <Text style={[s.statusText, { color: badge.fg }]}>{statusLabel}</Text>
            </View>
          </View>
        </View>

        <View style={s.divider} />

        <Text style={s.reportTitle}>{report.title}</Text>

        {/* Info cards */}
        <View style={s.infoRow}>
          <View style={s.infoCard}>
            <Text style={s.infoLabel}>Report</Text>
            <Text style={s.infoTextBold}>{sheetLabel}</Text>
            <Text style={s.infoText}>Sheet {report.type}</Text>
          </View>
          <View style={s.infoCard}>
            <Text style={s.infoLabel}>Project</Text>
            {project ? (
              <>
                <Text style={s.infoTextBold}>{project.name}</Text>
                <Text style={s.infoText}>{project.projectNumber}</Text>
              </>
            ) : (
              <Text style={s.infoText}>—</Text>
            )}
          </View>
        </View>

        {/* Body */}
        {template ? <SheetBody template={template} data={report.data} /> : <Narrative report={report} />}

        {/* Project snapshot */}
        {hasSnapshot ? (
          <View wrap={false}>
            <Text style={s.sectionBar}>Project snapshot (at submission)</Text>
            {report.snapshotProgress != null ? (
              <View>
                <View style={s.snapRow}>
                  <Text style={s.snapLabel}>Schedule progress</Text>
                  <Text style={s.snapValue}>{report.snapshotProgress}%</Text>
                </View>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: `${Math.max(0, Math.min(100, report.snapshotProgress))}%` }]} />
                </View>
              </View>
            ) : null}
            <View style={s.snapRow}><Text style={s.snapLabel}>Invoiced</Text><Text style={s.snapValue}>{money(report.snapshotRevenue)}</Text></View>
            <View style={s.snapRow}><Text style={s.snapLabel}>Supplier cost</Text><Text style={s.snapValue}>{money(report.snapshotCost)}</Text></View>
          </View>
        ) : null}

        {/* Sign-off / review trail */}
        <Text style={s.sectionBar}>Review &amp; sign-off</Text>
        <View style={s.signoffRow}>
          <SignoffBox label="Created" name={report.createdByName} when={report.createdAt} />
          <SignoffBox label="Submitted" name={report.submittedByName} when={report.submittedAt} />
          <SignoffBox label="Supervisor sign-off" name={report.reviewedByName} when={report.reviewedAt} />
          <SignoffBox label="Manager approval" name={report.approvedByName} when={report.approvedAt} />
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerMotto}>{company.tagline || "Qalibrated Systems"}</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `${serial}  ·  Page ${pageNumber} of ${totalPages}`}
            fixed
          />
        </View>
      </Page>
    </Document>
  );
}

export default TechnicalReportPDF;

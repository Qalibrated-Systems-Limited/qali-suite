// ============================================
// CALIBRATION CERTIFICATE & INSPECTION REPORT PDFs
// ============================================
// The documents the Calibration (ISO/IEC 17025) and Inspection (ISO/IEC 17020)
// screens issue. Both carry what the record holds — there is no measurement
// table in the data — on the same refined letterhead as the technical report
// (lib/pdf/refined.jsx): accent bar, boxed logo, coal title pill with the
// result as its badge, the key/value panel, gold-square section heads and the
// ISO footer.
// ============================================

import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatDate } from "../utils";
import { R, TopBar, RefinedHeader, TitlePill, RefinedFooter, SectionHead } from "../refined";

const colors = {
  dark: R.COAL,
  gray: R.MUTE,
  grayLight: "#E4DCCB",
  white: "#ffffff",
  green: R.PASS,
  amber: R.WAIT,
  red: R.FAIL,
  slate: R.MUTE,
};

const s = StyleSheet.create({
  page: { paddingTop: 26, paddingBottom: 84, paddingHorizontal: 32, fontSize: 9, color: R.INK, fontFamily: "Helvetica" },
  table: { borderTopWidth: 0.5, borderTopColor: colors.grayLight, marginBottom: 6 },
  row: { flexDirection: "row" },
  panelRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: colors.grayLight },
  keyBox: { width: "30%", backgroundColor: "#F7F4EC", paddingVertical: 4, paddingHorizontal: 7 },
  key: { fontFamily: "Helvetica-Bold", fontSize: 7, color: R.MUTE, letterSpacing: 0.3, textTransform: "uppercase" },
  val: { width: "70%", paddingVertical: 4, paddingHorizontal: 8, fontSize: 8.6, color: R.INK },
  th: { backgroundColor: R.COAL, color: colors.white, fontSize: 7.5, padding: 3, fontFamily: "Helvetica-Bold" },
  td: { fontSize: 8, padding: 3, borderBottomWidth: 0.5, borderBottomColor: "#DDD" },
  para: { fontSize: 8.6, lineHeight: 1.4 },
  statement: { fontSize: 7.6, color: R.MUTE, lineHeight: 1.45, marginTop: 14 },
  signRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 34 },
  sign: { width: "45%", borderTopWidth: 0.75, borderTopColor: R.COAL, paddingTop: 4 },
  signLabel: { fontSize: 7.5, color: R.MUTE, textTransform: "uppercase", letterSpacing: 0.4 },
  signName: { fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 2 },
});

function Letterhead({ company, kind, title, number, date, status }) {
  return (
    <>
      <TopBar kind={kind} />
      <RefinedHeader
        company={company}
        meta={[
          { k: "Date", v: date },
          { k: "No.", v: number, mono: true },
        ]}
      />
      <TitlePill title={title} status={status} />
    </>
  );
}

function Panel({ rows }) {
  return (
    <View style={s.table}>
      {rows.map(([k, v]) => (
        <View key={k} style={s.panelRow} wrap={false}>
          <View style={s.keyBox}>
            <Text style={s.key}>{k}</Text>
          </View>
          <Text style={s.val}>{v || "—"}</Text>
        </View>
      ))}
    </View>
  );
}

const RESULT = {
  passed: { label: "PASSED", bg: colors.green },
  failed: { label: "FAILED", bg: colors.red },
  pending: { label: "PENDING", bg: colors.slate },
};

/**
 * A calibration certificate for a completed, passed job. The reference
 * standards are the ones on the company's register, with their traceability,
 * because that is what the job was calibrated against.
 */
export function CalibrationCertificatePDF({ company, job, standards = [], issuedOn }) {
  const number = job.certNumber || job.jobNumber;
  const result = RESULT[job.result] || RESULT.pending;
  return (
    <Document title={`Calibration certificate ${number}`}>
      <Page size="A4" style={s.page}>
        <Letterhead
          company={company}
          kind="calibration"
          title="Calibration Certificate"
          number={number}
          date={formatDate(issuedOn)}
          status={{ label: result.label, bg: result.bg, color: colors.white }}
        />

        <SectionHead>Customer and item · ISO/IEC 17025</SectionHead>
        <Panel
          rows={[
            ["Customer", job.clientName],
            ["Location / site", job.site],
            ["Calibration service", job.serviceType],
            ["Job reference", job.jobNumber],
            ["Date of calibration", job.scheduledDate ? formatDate(job.scheduledDate) : null],
            ["Date of issue", formatDate(issuedOn)],
            ["Calibrated by", job.technicianName],
            ["Result", result.label],
          ]}
        />

        {standards.length > 0 && (
          <View wrap={false}>
            <SectionHead count={standards.length}>Reference standards</SectionHead>
            <View style={s.row}>
              <Text style={[s.th, { width: "34%" }]}>Standard</Text>
              <Text style={[s.th, { width: "30%" }]}>Traceability</Text>
              <Text style={[s.th, { width: "18%" }]}>Uncertainty</Text>
              <Text style={[s.th, { width: "18%" }]}>Cal. due</Text>
            </View>
            {standards.map((st) => (
              <View key={st.id} style={s.row}>
                <Text style={[s.td, { width: "34%" }]}>{st.name}</Text>
                <Text style={[s.td, { width: "30%" }]}>{st.traceability || "—"}</Text>
                <Text style={[s.td, { width: "18%" }]}>{st.uncertainty || "—"}</Text>
                <Text style={[s.td, { width: "18%" }]}>{st.nextCalibration ? formatDate(st.nextCalibration) : "—"}</Text>
              </View>
            ))}
          </View>
        )}

        {job.notes ? (
          <View wrap={false}>
            <SectionHead>Remarks</SectionHead>
            <Text style={s.para}>{job.notes}</Text>
          </View>
        ) : null}

        <Text style={s.statement}>
          This certificate relates only to the item calibrated at the time of calibration. It shall not be
          reproduced except in full without the written approval of {company?.name || "the issuing laboratory"}.
        </Text>

        <View style={s.signRow} wrap={false}>
          <View style={s.sign}>
            <Text style={s.signName}>{job.technicianName || " "}</Text>
            <Text style={s.signLabel}>Calibrated by</Text>
          </View>
          <View style={s.sign}>
            <Text style={s.signName}> </Text>
            <Text style={s.signLabel}>Authorised signatory</Text>
          </View>
        </View>

        <RefinedFooter company={company} serial={number} />
      </Page>
    </Document>
  );
}

const RULING = {
  pass: { label: "PASS", bg: colors.green },
  fail: { label: "FAIL", bg: colors.red },
  quarantined: { label: "QUARANTINED", bg: colors.amber },
  pending: { label: "PENDING", bg: colors.slate },
};
const APPEAL = { none: "No appeal", open: "Appeal open", upheld: "Appeal upheld", dismissed: "Appeal dismissed" };

export function InspectionReportPDF({ company, inspection, issuedOn }) {
  const number = inspection.inspectionNumber;
  const ruling = RULING[inspection.ruling] || RULING.pending;
  return (
    <Document title={`Inspection report ${number}`}>
      <Page size="A4" style={s.page}>
        <Letterhead
          company={company}
          kind="report"
          title="Inspection Report"
          number={number}
          date={formatDate(issuedOn)}
          status={{ label: ruling.label, bg: ruling.bg, color: colors.white }}
        />

        <SectionHead>Inspection · ISO/IEC 17020</SectionHead>
        <Panel
          rows={[
            ["Client", inspection.clientName],
            ["Type of inspection", inspection.type],
            ["Equipment serial no.", inspection.equipmentSerial],
            ["Date of inspection", inspection.scheduledDate ? formatDate(inspection.scheduledDate) : null],
            ["Inspector", inspection.inspectorName],
            ["Authority valid until", inspection.authorityExpiry ? formatDate(inspection.authorityExpiry) : null],
            ["Appeal", APPEAL[inspection.appealStatus] || inspection.appealStatus],
            ["Date of report", formatDate(issuedOn)],
            ["Ruling", ruling.label],
          ]}
        />

        {inspection.notes ? (
          <View wrap={false}>
            <SectionHead>Findings and remarks</SectionHead>
            <Text style={s.para}>{inspection.notes}</Text>
          </View>
        ) : null}

        <Text style={s.statement}>
          The results relate only to the item inspected at the time of inspection. This report shall not be
          reproduced except in full without the written approval of {company?.name || "the inspection body"}.
        </Text>

        <View style={s.signRow} wrap={false}>
          <View style={s.sign}>
            <Text style={s.signName}>{inspection.inspectorName || " "}</Text>
            <Text style={s.signLabel}>Inspector</Text>
          </View>
          <View style={s.sign}>
            <Text style={s.signName}> </Text>
            <Text style={s.signLabel}>Technical manager</Text>
          </View>
        </View>

        <RefinedFooter company={company} serial={number} />
      </Page>
    </Document>
  );
}

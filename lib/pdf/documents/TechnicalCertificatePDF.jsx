// ============================================
// CALIBRATION CERTIFICATE & INSPECTION REPORT PDFs
// ============================================
// The documents the Calibration (ISO/IEC 17025) and Inspection (ISO/IEC 17020)
// screens issue. Both carry what the record holds — there is no measurement
// table in the data — and the same house look as the technical report.
// ============================================

import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { formatDate, formatAddress } from "../utils";

const colors = {
  primary: "#eab308",
  dark: "#18181b",
  gray: "#71717a",
  grayLight: "#d4d4d8",
  grayLightest: "#f4f4f5",
  white: "#ffffff",
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
  slate: "#64748b",
};

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: 40, color: colors.dark, backgroundColor: colors.white },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  logo: { width: 140, height: 45, objectFit: "contain", marginBottom: 6 },
  companyName: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  companyDetails: { fontSize: 8, color: colors.gray, lineHeight: 1.4, marginTop: 2 },
  docHead: { alignItems: "flex-end" },
  docTitle: { fontSize: 18, fontFamily: "Helvetica-Bold", color: colors.primary },
  docSub: { fontSize: 8, color: colors.gray, marginTop: 2 },
  docNumber: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 4 },
  divider: { height: 2, backgroundColor: colors.primary, marginBottom: 16 },
  sectionBar: {
    fontSize: 9, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.4,
    borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 6, marginTop: 14, marginBottom: 8,
  },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: colors.grayLight, paddingVertical: 5 },
  key: { width: "34%", color: colors.gray },
  val: { width: "66%", fontFamily: "Helvetica-Bold" },
  resultBox: { marginTop: 14, padding: 12, borderRadius: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  resultLabel: { fontSize: 8, color: colors.white, textTransform: "uppercase", letterSpacing: 0.5 },
  resultValue: { fontSize: 16, fontFamily: "Helvetica-Bold", color: colors.white },
  thRow: { flexDirection: "row", backgroundColor: colors.dark, paddingVertical: 5, paddingHorizontal: 2 },
  th: { color: colors.white, fontSize: 7.5, fontFamily: "Helvetica-Bold", textTransform: "uppercase", paddingHorizontal: 3 },
  tdRow: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 2, borderBottomWidth: 0.5, borderBottomColor: colors.grayLight },
  td: { fontSize: 8.5, paddingHorizontal: 3 },
  para: { fontSize: 9.5, lineHeight: 1.5 },
  statement: { fontSize: 8, color: colors.gray, lineHeight: 1.5, marginTop: 14 },
  signRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 40 },
  sign: { width: "45%", borderTopWidth: 0.75, borderTopColor: colors.dark, paddingTop: 4 },
  signLabel: { fontSize: 8, color: colors.gray },
  signName: { fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  footer: {
    position: "absolute", bottom: 24, left: 40, right: 40, borderTopWidth: 1, borderTopColor: colors.grayLight,
    paddingTop: 8, flexDirection: "row", justifyContent: "space-between",
  },
  footerMotto: { fontSize: 8, color: colors.primary, fontFamily: "Helvetica-Bold" },
  footerText: { fontSize: 7, color: colors.gray },
});

function Letterhead({ company, title, sub, number }) {
  const logo = typeof company?.logo === "string" ? company.logo : company?.logo?.url;
  const address = formatAddress(company?.address);
  return (
    <>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          {logo ? <Image style={s.logo} src={logo} /> : null}
          <Text style={s.companyName}>{company?.name || ""}</Text>
          <Text style={s.companyDetails}>
            {address || ""}
            {company?.phone || company?.email ? `\n${[company.phone, company.email].filter(Boolean).join(" | ")}` : ""}
          </Text>
        </View>
        <View style={s.docHead}>
          <Text style={s.docTitle}>{title}</Text>
          <Text style={s.docSub}>{sub}</Text>
          <Text style={s.docNumber}>{number}</Text>
        </View>
      </View>
      <View style={s.divider} />
    </>
  );
}

function Row({ k, v }) {
  return (
    <View style={s.row}>
      <Text style={s.key}>{k}</Text>
      <Text style={s.val}>{v || "—"}</Text>
    </View>
  );
}

function Footer({ company, number }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerMotto}>{company?.tagline || company?.name || ""}</Text>
      <Text
        style={s.footerText}
        render={({ pageNumber, totalPages }) => `${number}  ·  Page ${pageNumber} of ${totalPages}`}
        fixed
      />
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
        <Letterhead company={company} title="CALIBRATION CERTIFICATE" sub="ISO/IEC 17025" number={number} />

        <Text style={s.sectionBar}>Customer and item</Text>
        <Row k="Customer" v={job.clientName} />
        <Row k="Location / site" v={job.site} />
        <Row k="Calibration service" v={job.serviceType} />
        <Row k="Job reference" v={job.jobNumber} />
        <Row k="Date of calibration" v={job.scheduledDate ? formatDate(job.scheduledDate) : null} />
        <Row k="Date of issue" v={formatDate(issuedOn)} />
        <Row k="Calibrated by" v={job.technicianName} />

        <View style={[s.resultBox, { backgroundColor: result.bg }]} wrap={false}>
          <Text style={s.resultLabel}>Result</Text>
          <Text style={s.resultValue}>{result.label}</Text>
        </View>

        {standards.length > 0 && (
          <View wrap={false}>
            <Text style={s.sectionBar}>Reference standards</Text>
            <View style={s.thRow}>
              <Text style={[s.th, { width: "34%" }]}>Standard</Text>
              <Text style={[s.th, { width: "30%" }]}>Traceability</Text>
              <Text style={[s.th, { width: "18%" }]}>Uncertainty</Text>
              <Text style={[s.th, { width: "18%" }]}>Cal. due</Text>
            </View>
            {standards.map((st) => (
              <View key={st.id} style={s.tdRow}>
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
            <Text style={s.sectionBar}>Remarks</Text>
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

        <Footer company={company} number={number} />
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
        <Letterhead company={company} title="INSPECTION REPORT" sub="ISO/IEC 17020" number={number} />

        <Text style={s.sectionBar}>Inspection</Text>
        <Row k="Client" v={inspection.clientName} />
        <Row k="Type of inspection" v={inspection.type} />
        <Row k="Equipment serial no." v={inspection.equipmentSerial} />
        <Row k="Date of inspection" v={inspection.scheduledDate ? formatDate(inspection.scheduledDate) : null} />
        <Row k="Inspector" v={inspection.inspectorName} />
        <Row k="Authority valid until" v={inspection.authorityExpiry ? formatDate(inspection.authorityExpiry) : null} />
        <Row k="Appeal" v={APPEAL[inspection.appealStatus] || inspection.appealStatus} />
        <Row k="Date of report" v={formatDate(issuedOn)} />

        <View style={[s.resultBox, { backgroundColor: ruling.bg }]} wrap={false}>
          <Text style={s.resultLabel}>Ruling</Text>
          <Text style={s.resultValue}>{ruling.label}</Text>
        </View>

        {inspection.notes ? (
          <View wrap={false}>
            <Text style={s.sectionBar}>Findings and remarks</Text>
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

        <Footer company={company} number={number} />
      </Page>
    </Document>
  );
}

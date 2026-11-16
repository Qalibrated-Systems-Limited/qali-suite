import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { R, TopBar, RefinedHeader, RefinedFooter } from "../refined";
import { longDate } from "../../hr/letters";

/**
 * An HR letter on the company letterhead (the same refined letterhead as the
 * technical reports): reference and date, the addressee, the subject, the
 * body as issued, the signature, and — where the employee's agreement or
 * receipt matters — an acknowledgement for them to sign.
 */

const ACK = new Set(["offer", "appointment", "probation_extension", "warning", "show_cause", "promotion", "salary_review", "transfer"]);

const s = StyleSheet.create({
  page: { paddingTop: 26, paddingBottom: 84, paddingHorizontal: 40, fontSize: 10, color: R.INK, fontFamily: "Helvetica" },
  to: { marginTop: 18, lineHeight: 1.4 },
  toName: { fontFamily: "Helvetica-Bold" },
  subject: { marginTop: 16, fontFamily: "Helvetica-Bold", textDecoration: "underline", textTransform: "uppercase", fontSize: 10 },
  para: { marginTop: 9, lineHeight: 1.5, textAlign: "justify" },
  sign: { marginTop: 26 },
  signLine: { marginTop: 34, width: 180, borderBottomWidth: 0.8, borderBottomColor: R.COAL },
  signName: { marginTop: 4, fontFamily: "Helvetica-Bold" },
  ack: { marginTop: 28, borderTopWidth: 0.8, borderTopColor: R.GOLD_DK, paddingTop: 10 },
  ackHead: { fontSize: 8, fontFamily: "Helvetica-Bold", color: R.MUTE, letterSpacing: 1, textTransform: "uppercase" },
  ackText: { marginTop: 6, fontSize: 9, lineHeight: 1.4 },
  ackRow: { flexDirection: "row", marginTop: 22 },
  ackCell: { flex: 1, marginRight: 16 },
  ackLabel: { fontSize: 7.5, color: R.MUTE, marginTop: 3, textTransform: "uppercase", letterSpacing: 0.4 },
  ackLine: { borderBottomWidth: 0.7, borderBottomColor: "#8a8171", height: 14 },
  void: {
    position: "absolute", top: 330, left: 90, fontSize: 90, color: "#B03A2E", opacity: 0.18,
    fontFamily: "Helvetica-Bold", transform: "rotate(-30deg)",
  },
});

export function HrLetterPDF({ letter, company }) {
  const paras = String(letter.body || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <Document title={`${letter.letter_number} ${letter.subject}`}>
      <Page size="A4" style={s.page} wrap>
        <TopBar kind="default" />
        <RefinedHeader
          company={company}
          meta={[
            { k: "Date", v: longDate(letter.issued_on) },
            { k: "Ref", v: letter.letter_number, mono: true },
          ]}
        />
        {letter.status === "void" ? <Text style={s.void} fixed>VOID</Text> : null}

        <View style={s.to}>
          <Text style={s.toName}>{letter.employee_name}</Text>
          <Text>Employee no. {letter.employee_number}</Text>
          {letter.designation ? <Text>{letter.designation}</Text> : null}
          {letter.department ? <Text>{letter.department}</Text> : null}
        </View>

        <Text style={s.subject}>RE: {letter.subject}</Text>
        {paras.map((p, i) => (
          <Text key={i} style={s.para}>{p}</Text>
        ))}

        <View style={s.sign} wrap={false}>
          <Text>Yours sincerely,</Text>
          <Text>For and on behalf of {company?.name || ""}</Text>
          <View style={s.signLine} />
          <Text style={s.signName}>{letter.signatory_name || ""}</Text>
          <Text>{letter.signatory_title || ""}</Text>
        </View>

        {ACK.has(letter.kind) ? (
          <View style={s.ack} wrap={false}>
            <Text style={s.ackHead}>Employee acknowledgement</Text>
            <Text style={s.ackText}>
              I, {letter.employee_name}, acknowledge receipt of this letter{letter.kind === "offer" || letter.kind === "appointment" ? " and accept the terms set out in it" : ""}.
            </Text>
            <View style={s.ackRow}>
              {["Signature", "Date"].map((l) => (
                <View key={l} style={s.ackCell}>
                  <View style={s.ackLine} />
                  <Text style={s.ackLabel}>{l}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <RefinedFooter company={company} serial={letter.letter_number} note="Confidential — for the named employee and the Human Resources file." />
      </Page>
    </Document>
  );
}

export default HrLetterPDF;

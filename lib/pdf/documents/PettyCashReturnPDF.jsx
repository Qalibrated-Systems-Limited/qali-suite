"use client";

import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

// ============================================
// PETTY CASH RETURNS FORM
// ============================================
// Matches the company's paper form: opening float in the header (the DR column
// is rare, so it lives here, not per row), a DATE/NAME/DESCRIPTION/PROJECT-or-
// PURPOSE/DR/CR/BALANCE table, totals, and the three sign-offs.
const colors = {
  primary: "#eab308",
  dark: "#18181b",
  gray: "#71717a",
  grayLight: "#d4d4d8",
  grayLightest: "#f4f4f5",
  white: "#ffffff",
  danger: "#dc2626",
  success: "#16a34a",
};

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 8, padding: 36, color: colors.dark },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  company: { fontSize: 13, fontFamily: "Helvetica-Bold", color: colors.dark },
  tagline: { fontSize: 7, fontFamily: "Helvetica-Oblique", color: colors.primary, marginTop: 2 },
  docHeader: { alignItems: "flex-end" },
  docTitle: { fontSize: 14, fontFamily: "Helvetica-Bold", color: colors.dark },
  docNumber: { fontSize: 8, color: colors.gray, marginTop: 3 },
  divider: { height: 2, backgroundColor: colors.primary, marginBottom: 12 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  metaBox: { flex: 1, backgroundColor: colors.grayLightest, padding: 8, borderRadius: 3, marginRight: 8 },
  metaBoxLast: { flex: 1, backgroundColor: "#fef3c7", padding: 8, borderRadius: 3 },
  label: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: colors.gray, textTransform: "uppercase", marginBottom: 2 },
  value: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  tHead: { flexDirection: "row", backgroundColor: colors.dark, paddingVertical: 5, paddingHorizontal: 4 },
  tHeadCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: colors.white, textTransform: "uppercase" },
  tRow: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.grayLight },
  tRowAlt: { backgroundColor: colors.grayLightest },
  cell: { fontSize: 7.5 },
  cDate: { width: "12%" },
  cName: { width: "18%" },
  cDesc: { width: "26%" },
  cProj: { width: "20%" },
  cDr: { width: "8%", textAlign: "right" },
  cCr: { width: "8%", textAlign: "right" },
  cBal: { width: "8%", textAlign: "right" },
  totalRow: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 4, backgroundColor: "#fef3c7", marginTop: 2 },
  totalLabel: { fontSize: 8, fontFamily: "Helvetica-Bold" },
  signs: { flexDirection: "row", justifyContent: "space-between", marginTop: 28 },
  signBox: { flex: 1, marginRight: 12 },
  signLine: { borderTopWidth: 1, borderTopColor: colors.dark, marginTop: 22, paddingTop: 3 },
  signRole: { fontSize: 7, fontFamily: "Helvetica-Bold" },
  signName: { fontSize: 7, color: colors.gray, marginTop: 1 },
  note: { marginTop: 18, padding: 8, backgroundColor: colors.grayLightest, borderLeftWidth: 3, borderLeftColor: colors.primary },
  noteText: { fontSize: 7, color: colors.gray, lineHeight: 1.4 },
});

const fmt = (n) =>
  n || n === 0 ? Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-");

export const PettyCashReturnPDF = ({ data, company }) => {
  const ret = data || {};
  const rows = ret.rows || [];
  const opening = ret.openingBalance || 0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>{company?.name || "Company"}</Text>
            <Text style={styles.tagline}>{company?.tagline || ""}</Text>
          </View>
          <View style={styles.docHeader}>
            <Text style={styles.docTitle}>PETTY CASH RETURNS FORM</Text>
            <Text style={styles.docNumber}>{ret.documentNumber}</Text>
            <Text style={styles.docNumber}>
              Status: {(ret.status || "draft").toUpperCase()}
            </Text>
          </View>
        </View>
        <View style={styles.divider} />

        {/* Meta: custodian, period, opening float (the DR lives here) */}
        <View style={styles.metaRow}>
          <View style={styles.metaBox}>
            <Text style={styles.label}>Custodian</Text>
            <Text style={styles.value}>{ret.custodian?.name || "-"}</Text>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.label}>Period</Text>
            <Text style={styles.value}>
              {fmtDate(ret.period?.from)} — {fmtDate(ret.period?.to)}
            </Text>
          </View>
          <View style={styles.metaBoxLast}>
            <Text style={styles.label}>Opening Float (b/f)</Text>
            <Text style={styles.value}>{fmt(opening)}</Text>
          </View>
        </View>

        {/* Ledger */}
        <View style={styles.tHead}>
          <Text style={[styles.tHeadCell, styles.cDate]}>Date</Text>
          <Text style={[styles.tHeadCell, styles.cName]}>Name</Text>
          <Text style={[styles.tHeadCell, styles.cDesc]}>Description</Text>
          <Text style={[styles.tHeadCell, styles.cProj]}>Project / Purpose</Text>
          <Text style={[styles.tHeadCell, styles.cDr]}>DR</Text>
          <Text style={[styles.tHeadCell, styles.cCr]}>CR</Text>
          <Text style={[styles.tHeadCell, styles.cBal]}>Balance</Text>
        </View>
        {rows.map((r, i) => (
          <View key={r._id || i} style={[styles.tRow, i % 2 ? styles.tRowAlt : null]}>
            <Text style={[styles.cell, styles.cDate]}>{fmtDate(r.date)}</Text>
            <Text style={[styles.cell, styles.cName]}>{r.name || "-"}</Text>
            <Text style={[styles.cell, styles.cDesc]}>{r.description}</Text>
            <Text style={[styles.cell, styles.cProj]}>{r.projectLabel || "-"}</Text>
            <Text style={[styles.cell, styles.cDr]}>{r.direction === "debit" ? fmt(r.amount) : "-"}</Text>
            <Text style={[styles.cell, styles.cCr]}>{r.direction === "credit" ? fmt(r.amount) : "-"}</Text>
            <Text style={[styles.cell, styles.cBal]}>{fmt(r.balance)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, { width: "56%" }]}>TOTAL</Text>
          <Text style={[styles.totalLabel, styles.cProj, { textAlign: "right" }]}>
            {opening ? `Opening ${fmt(opening)}` : ""}
          </Text>
          <Text style={[styles.totalLabel, styles.cDr]}>{fmt(ret.totals?.debits)}</Text>
          <Text style={[styles.totalLabel, styles.cCr]}>{fmt(ret.totals?.credits)}</Text>
          <Text style={[styles.totalLabel, styles.cBal]}>{fmt(ret.totals?.closing)}</Text>
        </View>

        {/* Sign-offs */}
        <View style={styles.signs}>
          <View style={styles.signBox}>
            <View style={styles.signLine}>
              <Text style={styles.signRole}>Prepared by (Custodian)</Text>
              <Text style={styles.signName}>{ret.preparedBy?.name || ""}</Text>
            </View>
          </View>
          <View style={styles.signBox}>
            <View style={styles.signLine}>
              <Text style={styles.signRole}>Reviewed by (Finance)</Text>
              <Text style={styles.signName}>{ret.reviewedBy?.name || ""}</Text>
            </View>
          </View>
          <View style={styles.signBox}>
            <View style={styles.signLine}>
              <Text style={styles.signRole}>Approved by (MD)</Text>
              <Text style={styles.signName}>{ret.approvedBy?.name || ""}</Text>
            </View>
          </View>
        </View>

        <View style={styles.note}>
          <Text style={styles.noteText}>
            All claims and returns go to the respective project files. Only
            approved expenses are recorded in this petty cash form. Purchases
            beyond the float are recorded as Bills/Expenses paid from the bank.
          </Text>
        </View>
      </Page>
    </Document>
  );
};

export default PettyCashReturnPDF;

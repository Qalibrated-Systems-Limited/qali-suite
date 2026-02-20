"use client";

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

// ============================================
// COLORS
// ============================================
const colors = {
  primary: "#eab308",
  primaryLight: "#fef3c7",
  dark: "#18181b",
  gray: "#71717a",
  grayLight: "#d4d4d8",
  grayLightest: "#f4f4f5",
  white: "#ffffff",
};

// ============================================
// STYLES
// ============================================
const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    padding: 40,
    backgroundColor: colors.white,
    color: colors.dark,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 25,
  },
  logoSection: {
    flex: 1,
  },
  logo: {
    width: 140,
    height: 45,
    objectFit: "contain",
    marginBottom: 6,
  },
  companyDetails: {
    fontSize: 8,
    color: colors.gray,
    lineHeight: 1.4,
  },
  companyTagline: {
    fontSize: 8,
    fontFamily: "Helvetica-Oblique",
    color: colors.primary,
    marginTop: 4,
  },
  docHeader: {
    alignItems: "flex-end",
  },
  docTitle: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
  docNumber: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
    marginTop: 4,
  },

  // Divider
  divider: {
    height: 2,
    backgroundColor: colors.primary,
    marginBottom: 20,
  },

  // Info Row
  infoRow: {
    flexDirection: "row",
    marginBottom: 20,
  },
  infoCard: {
    flex: 1,
    backgroundColor: colors.grayLightest,
    padding: 12,
    borderRadius: 4,
    marginRight: 10,
  },
  infoCardLast: {
    marginRight: 0,
    backgroundColor: colors.primaryLight,
  },
  label: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.gray,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  value: {
    fontSize: 9,
    color: colors.dark,
    lineHeight: 1.4,
  },
  valueBold: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
  },
  detailRow: {
    marginBottom: 6,
  },

  // Table
  table: {
    marginBottom: 15,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: colors.dark,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.white,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.grayLight,
  },
  tableRowAlt: {
    backgroundColor: colors.grayLightest,
  },
  tableCell: {
    fontSize: 9,
    color: colors.dark,
  },
  tableCellBold: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },

  // Columns (no price columns for delivery notes)
  colNo: { width: "8%" },
  colDesc: { width: "52%" },
  colQty: { width: "20%", textAlign: "center" },
  colUnit: { width: "20%", textAlign: "center" },

  // Notes
  notes: {
    marginTop: 20,
    padding: 12,
    backgroundColor: colors.grayLightest,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  notesTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  notesText: {
    fontSize: 8,
    color: colors.gray,
    lineHeight: 1.4,
  },

  // Signatures
  signatureSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 50,
  },
  signBox: {
    width: "30%",
  },
  signLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
    marginBottom: 4,
  },
  signName: {
    fontSize: 9,
    color: colors.gray,
    marginBottom: 30,
  },
  signLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.dark,
    marginBottom: 4,
  },
  signHint: {
    fontSize: 7,
    color: colors.gray,
    textAlign: "center",
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 25,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: colors.grayLight,
    paddingTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 7,
    color: colors.gray,
  },
  footerThank: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
});

// ============================================
// HELPERS
// ============================================
const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// ============================================
// DELIVERY NOTE PDF COMPONENT
// ============================================
export const DeliveryNotePDF = ({ deliveryNote, company }) => {
  return (
    <Document title={`Delivery Note ${deliveryNote.deliveryNumber}`}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoSection}>
            <Image style={styles.logo} src={company.logo || "/qsl.png"} />
            <Text style={styles.companyDetails}>
              {company.address}
              {company.city && `, ${company.city}`}
              {"\n"}
              {company.phone} | {company.email}
            </Text>
            {company.tagline && (
              <Text style={styles.companyTagline}>{company.tagline}</Text>
            )}
          </View>
          <View style={styles.docHeader}>
            <Text style={styles.docTitle}>DELIVERY NOTE</Text>
            <Text style={styles.docNumber}>
              {deliveryNote.deliveryNumber}
            </Text>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Customer & Delivery Details */}
        <View style={styles.infoRow}>
          <View style={styles.infoCard}>
            <Text style={styles.label}>Deliver To</Text>
            <Text style={styles.valueBold}>
              {deliveryNote.customer?.name}
            </Text>
            <Text style={styles.value}>
              {deliveryNote.customer?.address}
              {deliveryNote.customer?.phone &&
                `\n${deliveryNote.customer.phone}`}
            </Text>
          </View>
          <View style={[styles.infoCard, styles.infoCardLast]}>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Date</Text>
              <Text style={styles.valueBold}>
                {formatDate(deliveryNote.date)}
              </Text>
            </View>
            {deliveryNote.reason && (
              <View style={styles.detailRow}>
                <Text style={styles.label}>Reason</Text>
                <Text style={styles.value}>{deliveryNote.reason}</Text>
              </View>
            )}
            {deliveryNote.technician?.name && (
              <View style={styles.detailRow}>
                <Text style={styles.label}>Technician</Text>
                <Text style={styles.value}>
                  {deliveryNote.technician.name}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colNo]}>#</Text>
            <Text style={[styles.tableHeaderCell, styles.colDesc]}>
              Description
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
            <Text style={[styles.tableHeaderCell, styles.colUnit]}>Unit</Text>
          </View>
          {deliveryNote.items?.map((item, i) => (
            <View
              key={i}
              style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}
            >
              <Text style={[styles.tableCell, styles.colNo]}>{i + 1}</Text>
              <Text style={[styles.tableCellBold, styles.colDesc]}>
                {item.name}
              </Text>
              <Text style={[styles.tableCell, styles.colQty]}>
                {item.quantity}
              </Text>
              <Text style={[styles.tableCell, styles.colUnit]}>
                {item.unit || "pcs"}
              </Text>
            </View>
          ))}
        </View>

        {/* Notes */}
        {deliveryNote.notes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.notesText}>{deliveryNote.notes}</Text>
          </View>
        )}

        {/* Signatures */}
        <View style={styles.signatureSection}>
          <View style={styles.signBox}>
            <Text style={styles.signLabel}>Store Manager</Text>
            <Text style={styles.signName}>{"________________"}</Text>
            <View style={styles.signLine} />
            <Text style={styles.signHint}>Signature & Date</Text>
          </View>
          <View style={styles.signBox}>
            <Text style={styles.signLabel}>Delivered By</Text>
            <Text style={styles.signName}>
              {deliveryNote.createdBy?.name || "________________"}
            </Text>
            <View style={styles.signLine} />
            <Text style={styles.signHint}>Signature & Date</Text>
          </View>
          <View style={styles.signBox}>
            <Text style={styles.signLabel}>Received By</Text>
            <Text style={styles.signName}>{"________________"}</Text>
            <View style={styles.signLine} />
            <Text style={styles.signHint}>Signature & Date</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {company.name} | {company.phone} | {company.email}
          </Text>
          <Text style={styles.footerThank}>Thank you for your business!</Text>
        </View>
      </Page>
    </Document>
  );
};

export default DeliveryNotePDF;

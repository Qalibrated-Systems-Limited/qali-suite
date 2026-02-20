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
  primary: "#eab308", // Yellow to match app theme
  primaryLight: "#fef3c7",
  dark: "#18181b",
  gray: "#71717a",
  grayLight: "#d4d4d8",
  grayLightest: "#f4f4f5",
  white: "#ffffff",
  success: "#16a34a",
  warning: "#eab308",
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
  creditNoteHeader: {
    alignItems: "flex-end",
  },
  creditNoteTitle: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
  creditNoteNumber: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 3,
    marginTop: 6,
  },
  statusText: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
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
  customerBox: {
    flex: 1,
    backgroundColor: colors.grayLightest,
    padding: 12,
    borderRadius: 4,
    marginRight: 10,
  },
  creditNoteDetails: {
    flex: 1,
    backgroundColor: colors.primaryLight,
    padding: 12,
    borderRadius: 4,
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

  // Reason Box
  reasonBox: {
    backgroundColor: colors.primaryLight,
    padding: 12,
    borderRadius: 4,
    marginBottom: 20,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  reasonTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  reasonText: {
    fontSize: 9,
    color: colors.dark,
  },

  // Table
  table: {
    marginBottom: 15,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: colors.primary,
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
  tableCellSub: {
    fontSize: 7,
    color: colors.gray,
    marginTop: 2,
  },

  // Columns
  colNo: { width: "6%" },
  colDesc: { width: "42%" },
  colQty: { width: "10%", textAlign: "center" },
  colPrice: { width: "21%", textAlign: "right" },
  colAmount: { width: "21%", textAlign: "right" },

  // Totals
  totalsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  totalsBox: {
    width: 220,
  },
  totalLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.grayLight,
  },
  totalFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.primary,
    marginTop: 2,
  },
  totalLabel: {
    fontSize: 9,
    color: colors.gray,
  },
  totalValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  totalLabelFinal: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.white,
  },
  totalValueFinal: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: colors.white,
  },

  // Credit Notice
  creditNotice: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.primaryLight,
    padding: 12,
    marginTop: 15,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 4,
  },
  creditNoticeLabel: {
    fontSize: 9,
    color: colors.primary,
    fontFamily: "Helvetica-Bold",
  },
  creditNoticeValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },

  // Notes
  notes: {
    marginTop: 20,
    padding: 12,
    backgroundColor: colors.grayLightest,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.gray,
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
  footerNote: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
});

// ============================================
// HELPERS
// ============================================
const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return "KES 0.00";
  return `KES ${Number(amount).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatAddress = (address) => {
  if (!address) return "";
  if (typeof address === "string") {
    try {
      const parsed = JSON.parse(address);
      if (typeof parsed === "object" && parsed !== null) {
        const parts = [
          parsed.street || parsed.line1,
          parsed.line2,
          parsed.city,
          parsed.state,
          parsed.postalCode,
          parsed.country,
        ].filter(Boolean);
        return parts.join(", ");
      }
    } catch {
      return address;
    }
  }
  if (typeof address === "object") {
    const parts = [
      address.street || address.line1,
      address.line2,
      address.city,
      address.state,
      address.postalCode,
      address.country,
    ].filter(Boolean);
    return parts.join(", ");
  }
  return "";
};

const getReasonLabel = (reason) => {
  const labels = {
    return: "Goods Returned",
    damaged: "Damaged Goods",
    overcharge: "Price Correction",
    cancellation: "Order Cancellation",
    discount: "Post-Sale Discount",
    defective: "Defective Goods",
    other: "Other",
  };
  return labels[reason] || reason;
};

// ============================================
// CREDIT NOTE PDF COMPONENT
// ============================================
export const CreditNotePDF = ({ creditNote, company }) => {
  const getStatusColor = () => {
    switch (creditNote.status) {
      case "issued":
        return { bg: "#dcfce7", text: "#16a34a" };
      case "applied":
        return { bg: "#dbeafe", text: "#2563eb" };
      case "void":
        return { bg: "#fee2e2", text: "#dc2626" };
      default:
        return { bg: "#fef3c7", text: "#ca8a04" };
    }
  };

  const statusColor = getStatusColor();

  return (
    <Document title={`Credit Note ${creditNote.creditNoteNumber}`}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoSection}>
            <Image style={styles.logo} src={company.logo || "/qsl.png"} />
            <Text style={styles.companyDetails}>
              {formatAddress(company.address)}
              {company.city && `, ${company.city}`}
              {"\n"}
              {company.phone} | {company.email}
              {company.taxPin && `\n${company.taxPin}`}
            </Text>
            {company.tagline && (
              <Text style={styles.companyTagline}>{company.tagline}</Text>
            )}
          </View>
          <View style={styles.creditNoteHeader}>
            <Text style={styles.creditNoteTitle}>CREDIT NOTE</Text>
            <Text style={styles.creditNoteNumber}>
              {creditNote.creditNoteNumber}
            </Text>
            <View
              style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}
            >
              <Text style={[styles.statusText, { color: statusColor.text }]}>
                {creditNote.status.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Customer & Credit Note Details */}
        <View style={styles.infoRow}>
          <View style={styles.customerBox}>
            <Text style={styles.label}>Credit To</Text>
            <Text style={styles.valueBold}>{creditNote.customer?.name}</Text>
            <Text style={styles.value}>
              {formatAddress(creditNote.customer?.address)}
              {creditNote.customer?.phone && `\n${creditNote.customer.phone}`}
              {creditNote.customer?.email && `\n${creditNote.customer.email}`}
              {creditNote.customer?.taxPin &&
                `\nPIN: ${creditNote.customer.taxPin}`}
            </Text>
          </View>
          <View style={styles.creditNoteDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Credit Note Date</Text>
              <Text style={styles.valueBold}>
                {formatDate(creditNote.creditNoteDate)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Original Invoice</Text>
              <Text style={styles.valueBold}>
                {creditNote.invoice?.invoiceNumber}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Invoice Date</Text>
              <Text style={styles.value}>
                {formatDate(creditNote.invoice?.invoiceDate)}
              </Text>
            </View>
          </View>
        </View>

        {/* Reason Box */}
        <View style={styles.reasonBox}>
          <Text style={styles.reasonTitle}>
            Reason: {getReasonLabel(creditNote.reason)}
          </Text>
          <Text style={styles.reasonText}>{creditNote.reasonDescription}</Text>
        </View>

        {/* Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colNo]}>#</Text>
            <Text style={[styles.tableHeaderCell, styles.colDesc]}>
              Description
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
            <Text style={[styles.tableHeaderCell, styles.colPrice]}>Price</Text>
            <Text style={[styles.tableHeaderCell, styles.colAmount]}>
              Credit
            </Text>
          </View>
          {creditNote.items?.map((item, i) => (
            <View
              key={i}
              style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}
            >
              <Text style={[styles.tableCell, styles.colNo]}>{i + 1}</Text>
              <View style={styles.colDesc}>
                <Text style={styles.tableCellBold}>
                  {item.productName || item.description}
                </Text>
                {item.productSKU && (
                  <Text style={styles.tableCellSub}>SKU: {item.productSKU}</Text>
                )}
                {item.restoreInventory && (
                  <Text style={[styles.tableCellSub, { color: colors.success }]}>
                    Inventory restored
                  </Text>
                )}
              </View>
              <Text style={[styles.tableCell, styles.colQty]}>
                {item.quantity}
              </Text>
              <Text style={[styles.tableCell, styles.colPrice]}>
                {formatCurrency(item.unitPrice)}
              </Text>
              <Text style={[styles.tableCellBold, styles.colAmount]}>
                {formatCurrency(item.amount)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsRow}>
          <View style={styles.totalsBox}>
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(creditNote.subtotal)}
              </Text>
            </View>
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>VAT (16%)</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(creditNote.taxAmount)}
              </Text>
            </View>
            <View style={styles.totalFinal}>
              <Text style={styles.totalLabelFinal}>CREDIT TOTAL</Text>
              <Text style={styles.totalValueFinal}>
                {formatCurrency(creditNote.total)}
              </Text>
            </View>
          </View>
        </View>

        {/* Credit Notice */}
        <View style={styles.creditNotice}>
          <View>
            <Text style={styles.creditNoticeLabel}>
              This credit will be applied to your account
            </Text>
            {creditNote.amountApplied > 0 && (
              <Text style={{ fontSize: 7, color: colors.gray }}>
                Applied: {formatCurrency(creditNote.amountApplied)}
              </Text>
            )}
          </View>
          <Text style={styles.creditNoticeValue}>
            {formatCurrency(creditNote.amountRemaining || creditNote.total)}
          </Text>
        </View>

        {/* Notes */}
        {creditNote.notes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.notesText}>{creditNote.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {company.name} | {company.phone} | {company.email}
          </Text>
          <Text style={styles.footerNote}>
            Credit Note - {creditNote.creditNoteNumber}
          </Text>
        </View>
      </Page>
    </Document>
  );
};

export default CreditNotePDF;

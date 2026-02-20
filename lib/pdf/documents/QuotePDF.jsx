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
// COLORS - Matching InvoicePDF theme
// ============================================
const colors = {
  primary: "#eab308",
  primaryLight: "#fef3c7",
  dark: "#18181b",
  gray: "#71717a",
  grayLight: "#d4d4d8",
  grayLightest: "#f4f4f5",
  white: "#ffffff",
  success: "#16a34a",
  danger: "#dc2626",
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
  quoteHeader: {
    alignItems: "flex-end",
  },
  quoteTitle: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
  quoteNumber: {
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
  quoteDetails: {
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

  // Validity Notice
  validityNotice: {
    backgroundColor: colors.primaryLight,
    padding: 10,
    borderRadius: 4,
    marginBottom: 15,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  validityText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
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
    color: colors.dark,
  },
  totalValueFinal: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
  },

  // Notes & Terms
  notesSection: {
    marginTop: 20,
  },
  notesBox: {
    padding: 12,
    backgroundColor: colors.grayLightest,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    marginBottom: 10,
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

  // Acceptance Section
  acceptanceSection: {
    marginTop: 20,
    padding: 15,
    backgroundColor: colors.grayLightest,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  acceptanceTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
    marginBottom: 8,
  },
  signatureRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 15,
  },
  signatureBox: {
    width: "45%",
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: colors.dark,
    marginBottom: 4,
    height: 25,
  },
  signatureLabel: {
    fontSize: 7,
    color: colors.gray,
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
      if (address.startsWith("{") && address.endsWith("}")) {
        try {
          const jsonStr = address
            .replace(/(\w+):/g, '"$1":')
            .replace(/'/g, '"');
          const parsed = JSON.parse(jsonStr);
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

// ============================================
// QUOTE PDF COMPONENT
// ============================================
export const QuotePDF = ({ quote, company }) => {
  const safeCompany = company || {};

  const isExpired =
    new Date() > new Date(quote.validUntil) &&
    !["converted", "cancelled", "rejected", "expired"].includes(quote.status);

  const getStatusColor = () => {
    if (isExpired || quote.status === "expired")
      return { bg: "#fee2e2", text: "#dc2626" };
    if (quote.status === "accepted" || quote.status === "converted")
      return { bg: "#dcfce7", text: "#16a34a" };
    if (quote.status === "rejected")
      return { bg: "#fee2e2", text: "#dc2626" };
    if (quote.status === "sent")
      return { bg: "#dbeafe", text: "#2563eb" };
    return { bg: "#fef3c7", text: "#ca8a04" };
  };

  const getStatusText = () => {
    if (isExpired) return "EXPIRED";
    return quote.status?.toUpperCase() || "DRAFT";
  };

  const statusColor = getStatusColor();

  const daysUntilExpiry = Math.ceil(
    (new Date(quote.validUntil) - new Date()) / (1000 * 60 * 60 * 24),
  );

  return (
    <Document title={`Quote ${quote.quoteNumber}`}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoSection}>
            <Image style={styles.logo} src={company.logo || "/qsl.png"} />
            <Text style={styles.companyDetails}>
              {safeCompany.fullAddress || formatAddress(safeCompany.address)}
              {"\n"}
              {safeCompany.phone && `${safeCompany.phone}`}
              {safeCompany.phone && safeCompany.email && " | "}
              {safeCompany.email && `${safeCompany.email}`}
              {safeCompany.taxPin && `\nPIN: ${safeCompany.taxPin}`}
            </Text>
            {safeCompany.tagline && (
              <Text style={styles.companyTagline}>{safeCompany.tagline}</Text>
            )}
          </View>
          <View style={styles.quoteHeader}>
            <Text style={styles.quoteTitle}>QUOTATION</Text>
            <Text style={styles.quoteNumber}>{quote.quoteNumber}</Text>
            {quote.title && (
              <Text style={{ fontSize: 8, color: colors.gray, fontStyle: "italic", marginTop: 2 }}>
                {quote.title}
              </Text>
            )}
            <View
              style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}
            >
              <Text style={[styles.statusText, { color: statusColor.text }]}>
                {getStatusText()}
              </Text>
            </View>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Customer & Quote Details */}
        <View style={styles.infoRow}>
          <View style={styles.customerBox}>
            <Text style={styles.label}>Prepared For</Text>
            <Text style={styles.valueBold}>{quote.customer?.name}</Text>
            <Text style={styles.value}>
              {formatAddress(quote.customer?.address)}
              {quote.customer?.phone && `\n${quote.customer.phone}`}
              {quote.customer?.email && `\n${quote.customer.email}`}
              {quote.customer?.taxPin && `\nPIN: ${quote.customer.taxPin}`}
            </Text>
          </View>
          <View style={styles.quoteDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Quote Date</Text>
              <Text style={styles.valueBold}>
                {formatDate(quote.quoteDate)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Valid Until</Text>
              <Text
                style={[
                  styles.valueBold,
                  isExpired && { color: colors.danger },
                ]}
              >
                {formatDate(quote.validUntil)}
              </Text>
            </View>
            {quote.reference && (
              <View style={styles.detailRow}>
                <Text style={styles.label}>Reference</Text>
                <Text style={styles.value}>{quote.reference}</Text>
              </View>
            )}
            {quote.salesPerson?.name && (
              <View style={styles.detailRow}>
                <Text style={styles.label}>Sales Person</Text>
                <Text style={styles.value}>{quote.salesPerson.name}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Validity Notice */}
        {!isExpired && daysUntilExpiry > 0 && daysUntilExpiry <= 14 && (
          <View style={styles.validityNotice}>
            <Text style={styles.validityText}>
              This quote is valid for {daysUntilExpiry} more day
              {daysUntilExpiry !== 1 ? "s" : ""}
            </Text>
          </View>
        )}

        {/* Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colNo]}>#</Text>
            <Text style={[styles.tableHeaderCell, styles.colDesc]}>
              Description
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
            <Text style={[styles.tableHeaderCell, styles.colPrice]}>
              Unit Price
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colAmount]}>
              Amount
            </Text>
          </View>
          {quote.items?.map((item, i) => (
            <View
              key={i}
              style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}
            >
              <Text style={[styles.tableCell, styles.colNo]}>
                {item.lineNumber || i + 1}
              </Text>
              <View style={styles.colDesc}>
                <Text style={styles.tableCellBold}>
                  {item.product?.name || item.description}
                </Text>
                {item.product?.sku && (
                  <Text style={styles.tableCellSub}>
                    SKU: {item.product.sku}
                  </Text>
                )}
                {item.description &&
                  item.description !== item.product?.name && (
                    <Text style={styles.tableCellSub}>{item.description}</Text>
                  )}
              </View>
              <Text style={[styles.tableCell, styles.colQty]}>
                {item.quantity} {item.unit}
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
                {formatCurrency(quote.subtotal)}
              </Text>
            </View>
            {quote.totalDiscount > 0 && (
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Discount</Text>
                <Text style={[styles.totalValue, { color: colors.success }]}>
                  -{formatCurrency(quote.totalDiscount)}
                </Text>
              </View>
            )}
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>VAT (16%)</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(quote.taxAmount)}
              </Text>
            </View>
            <View style={styles.totalFinal}>
              <Text style={styles.totalLabelFinal}>TOTAL</Text>
              <Text style={styles.totalValueFinal}>
                {formatCurrency(quote.total)}
              </Text>
            </View>
          </View>
        </View>

        {/* Notes & Terms */}
        {(quote.notes || quote.termsAndConditions) && (
          <View style={styles.notesSection}>
            {quote.notes && (
              <View style={styles.notesBox}>
                <Text style={styles.notesTitle}>Notes</Text>
                <Text style={styles.notesText}>{quote.notes}</Text>
              </View>
            )}
            {quote.termsAndConditions && (
              <View style={styles.notesBox}>
                <Text style={styles.notesTitle}>Terms & Conditions</Text>
                <Text style={styles.notesText}>{quote.termsAndConditions}</Text>
              </View>
            )}
          </View>
        )}

        {/* Acceptance Section */}
        <View style={styles.acceptanceSection}>
          <Text style={styles.acceptanceTitle}>Acceptance</Text>
          <Text style={styles.notesText}>
            By signing below, you accept this quotation and authorize us to
            proceed with the order.
          </Text>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBox}>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureLabel}>Customer Signature</Text>
            </View>
            <View style={styles.signatureBox}>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureLabel}>Date</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {safeCompany.name}
            {safeCompany.phone && ` | ${safeCompany.phone}`}
            {safeCompany.email && ` | ${safeCompany.email}`}
          </Text>
          <Text style={styles.footerThank}>Thank you for your business!</Text>
        </View>
      </Page>
    </Document>
  );
};

export default QuotePDF;

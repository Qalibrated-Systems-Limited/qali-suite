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
  invoiceHeader: {
    alignItems: "flex-end",
  },
  invoiceTitle: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
  invoiceNumber: {
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
  billTo: {
    flex: 1,
    backgroundColor: colors.grayLightest,
    padding: 12,
    borderRadius: 4,
    marginRight: 10,
  },
  invoiceDetails: {
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

  // Amount Due
  amountDue: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.grayLightest,
    padding: 12,
    marginTop: 15,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 4,
  },
  amountDueLabel: {
    fontSize: 9,
    color: colors.gray,
  },
  amountDueValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },

  // Payment Section
  paymentSection: {
    flexDirection: "row",
    marginTop: 20,
  },
  paymentBox: {
    flex: 1,
    backgroundColor: colors.grayLightest,
    padding: 12,
    borderRadius: 4,
    marginRight: 10,
  },
  paymentBoxLast: {
    marginRight: 0,
  },
  paymentTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
    textTransform: "uppercase",
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.grayLight,
    paddingBottom: 4,
  },
  paymentRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  paymentLabel: {
    fontSize: 8,
    color: colors.gray,
    width: 70,
  },
  paymentValue: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
    flex: 1,
  },

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

// Handle address that might be stored as JSON string, JS object literal, or object
const formatAddress = (address) => {
  if (!address) return "";

  // If it's a string, try to parse it
  if (typeof address === "string") {
    // Try to parse as JSON first (handles {"country":"Kenya"} case)
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
      // Not valid JSON - check if it's a JS object literal like "{ country: 'Kenya' }"
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

  // If it's an object, extract parts
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
// INVOICE PDF COMPONENT
// ============================================
export const InvoicePDF = ({ invoice, company }) => {
  console.log(company.tagline);
  const isOverdue =
    invoice.paymentStatus !== "paid" &&
    invoice.status === "completed" &&
    new Date(invoice.dueDate) < new Date();

  const getStatusColor = () => {
    if (isOverdue) return { bg: "#fee2e2", text: "#dc2626" };
    if (invoice.paymentStatus === "paid")
      return { bg: "#dcfce7", text: "#16a34a" };
    if (invoice.paymentStatus === "partial")
      return { bg: "#dbeafe", text: "#2563eb" };
    return { bg: "#fef3c7", text: "#ca8a04" };
  };

  const getStatusText = () => {
    if (isOverdue) return "OVERDUE";
    if (invoice.paymentStatus === "paid") return "PAID";
    if (invoice.paymentStatus === "partial") return "PARTIAL";
    return "UNPAID";
  };

  const statusColor = getStatusColor();

  return (
    <Document title={`Invoice ${invoice.invoiceNumber}`}>
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
              {company.taxPin && `\n${company.taxPin}`}
            </Text>
            {company.tagline && (
              <Text style={styles.companyTagline}>{company.tagline}</Text>
            )}
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
            {invoice.title && (
              <Text style={{ fontSize: 8, color: colors.gray, fontStyle: "italic", marginTop: 2 }}>
                {invoice.title}
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

        {/* Bill To & Invoice Details */}
        <View style={styles.infoRow}>
          <View style={styles.billTo}>
            <Text style={styles.label}>Bill To</Text>
            <Text style={styles.valueBold}>{invoice.customer?.name}</Text>
            <Text style={styles.value}>
              {formatAddress(invoice.customer?.address)}
              {invoice.customer?.phone && `\n${invoice.customer.phone}`}
              {invoice.customer?.email && `\n${invoice.customer.email}`}
              {invoice.customer?.taxPin && `\nPIN: ${invoice.customer.taxPin}`}
            </Text>
          </View>
          <View style={styles.invoiceDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Invoice Date</Text>
              <Text style={styles.valueBold}>
                {formatDate(invoice.invoiceDate)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Due Date</Text>
              <Text
                style={[
                  styles.valueBold,
                  isOverdue && { color: colors.danger },
                ]}
              >
                {formatDate(invoice.dueDate)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Payment Terms</Text>
              <Text style={styles.value}>
                {invoice.paymentTerms || "Due on Receipt"}
              </Text>
            </View>
            {invoice.purchaseOrderNumber && (
              <View style={styles.detailRow}>
                <Text style={styles.label}>PO Number</Text>
                <Text style={styles.value}>{invoice.purchaseOrderNumber}</Text>
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
            <Text style={[styles.tableHeaderCell, styles.colPrice]}>Price</Text>
            <Text style={[styles.tableHeaderCell, styles.colAmount]}>
              Amount
            </Text>
          </View>
          {invoice.items?.map((item, i) => (
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
                  <Text style={styles.tableCellSub}>
                    SKU: {item.productSKU}
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
                {formatCurrency(invoice.subtotal)}
              </Text>
            </View>
            {invoice.totalDiscount > 0 && (
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Discount</Text>
                <Text style={[styles.totalValue, { color: colors.success }]}>
                  -{formatCurrency(invoice.totalDiscount)}
                </Text>
              </View>
            )}
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>VAT (16%)</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(invoice.taxAmount)}
              </Text>
            </View>
            <View style={styles.totalFinal}>
              <Text style={styles.totalLabelFinal}>TOTAL</Text>
              <Text style={styles.totalValueFinal}>
                {formatCurrency(invoice.total)}
              </Text>
            </View>
          </View>
        </View>

        {/* Amount Due */}
        {invoice.paymentStatus !== "paid" && (
          <View style={styles.amountDue}>
            <View>
              <Text style={styles.amountDueLabel}>Amount Due</Text>
              {invoice.amountPaid > 0 && (
                <Text style={{ fontSize: 7, color: colors.gray }}>
                  Paid: {formatCurrency(invoice.amountPaid)}
                </Text>
              )}
            </View>
            <Text style={styles.amountDueValue}>
              {formatCurrency(invoice.amountDue)}
            </Text>
          </View>
        )}

        {/* Payment Methods */}
        <View style={styles.paymentSection}>
          <View style={styles.paymentBox}>
            <Text style={styles.paymentTitle}>Bank Transfer</Text>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Bank:</Text>
              <Text style={styles.paymentValue}>{company.bankName}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Branch:</Text>
              <Text style={styles.paymentValue}>{company.bankBranch}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Account:</Text>
              <Text style={styles.paymentValue}>{company.accountName}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Acc No:</Text>
              <Text style={styles.paymentValue}>{company.accountNumber}</Text>
            </View>
          </View>
          <View style={[styles.paymentBox, styles.paymentBoxLast]}>
            <Text style={styles.paymentTitle}>M-Pesa</Text>
            {company.mpesaPaybill && (
              <>
                <View style={styles.paymentRow}>
                  <Text style={styles.paymentLabel}>Paybill:</Text>
                  <Text style={styles.paymentValue}>
                    {company.mpesaPaybill}
                  </Text>
                </View>
                <View style={styles.paymentRow}>
                  <Text style={styles.paymentLabel}>Account:</Text>
                  <Text style={styles.paymentValue}>
                    {invoice.invoiceNumber}
                  </Text>
                </View>
              </>
            )}
            {company.mpesaTill && (
              <View style={styles.paymentRow}>
                <Text style={styles.paymentLabel}>Till No:</Text>
                <Text style={styles.paymentValue}>{company.mpesaTill}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Notes & Terms */}
        {(invoice.notes || invoice.termsAndConditions) && (
          <View style={styles.notes}>
            {invoice.notes && (
              <View>
                <Text style={styles.notesTitle}>Notes</Text>
                <Text style={styles.notesText}>{invoice.notes}</Text>
              </View>
            )}
            {invoice.termsAndConditions && (
              <View style={{ marginTop: invoice.notes ? 6 : 0 }}>
                <Text style={styles.notesTitle}>Terms & Conditions</Text>
                <Text style={styles.notesText}>{invoice.termsAndConditions}</Text>
              </View>
            )}
          </View>
        )}

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

export default InvoicePDF;

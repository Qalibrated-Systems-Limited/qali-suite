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
// SALES ORDER PDF — mirrors QuotePDF's theme/layout. A sales order is a
// CONFIRMED order (not an offer), so: no "valid until" / acceptance
// signature; instead order date, expected delivery, and the order status.
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
  blue: "#2563eb",
};

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: 40, backgroundColor: colors.white, color: colors.dark },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 25 },
  logoSection: { flex: 1 },
  logo: { width: 140, height: 45, objectFit: "contain", marginBottom: 6 },
  companyDetails: { fontSize: 8, color: colors.gray, lineHeight: 1.4 },
  companyTagline: { fontSize: 8, fontFamily: "Helvetica-Oblique", color: colors.primary, marginTop: 4 },
  docHeader: { alignItems: "flex-end" },
  docTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", color: colors.primary },
  docNumber: { fontSize: 10, fontFamily: "Helvetica-Bold", color: colors.dark, marginTop: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3, marginTop: 6 },
  statusText: { fontSize: 7, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  divider: { height: 2, backgroundColor: colors.primary, marginBottom: 20 },
  infoRow: { flexDirection: "row", marginBottom: 20 },
  customerBox: { flex: 1, backgroundColor: colors.grayLightest, padding: 12, borderRadius: 4, marginRight: 10 },
  docDetails: { flex: 1, backgroundColor: colors.primaryLight, padding: 12, borderRadius: 4 },
  label: { fontSize: 7, fontFamily: "Helvetica-Bold", color: colors.gray, textTransform: "uppercase", marginBottom: 3 },
  value: { fontSize: 9, color: colors.dark, lineHeight: 1.4 },
  valueBold: { fontSize: 10, fontFamily: "Helvetica-Bold", color: colors.dark },
  detailRow: { marginBottom: 6 },
  table: { marginBottom: 15 },
  tableHeader: { flexDirection: "row", backgroundColor: colors.dark, paddingVertical: 8, paddingHorizontal: 10 },
  tableHeaderCell: { fontSize: 8, fontFamily: "Helvetica-Bold", color: colors.white, textTransform: "uppercase" },
  tableRow: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.grayLight },
  tableRowAlt: { backgroundColor: colors.grayLightest },
  tableCell: { fontSize: 9, color: colors.dark },
  tableCellBold: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  tableCellSub: { fontSize: 7, color: colors.gray, marginTop: 2 },
  colNo: { width: "6%" },
  colDesc: { width: "42%" },
  colQty: { width: "10%", textAlign: "center" },
  colPrice: { width: "21%", textAlign: "right" },
  colAmount: { width: "21%", textAlign: "right" },
  totalsRow: { flexDirection: "row", justifyContent: "flex-end" },
  totalsBox: { width: 220 },
  totalLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.grayLight },
  totalFinal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, paddingHorizontal: 10, backgroundColor: colors.primary, marginTop: 2 },
  totalLabel: { fontSize: 9, color: colors.gray },
  totalValue: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  totalLabelFinal: { fontSize: 10, fontFamily: "Helvetica-Bold", color: colors.dark },
  totalValueFinal: { fontSize: 12, fontFamily: "Helvetica-Bold", color: colors.dark },
  notesSection: { marginTop: 20 },
  notesBox: { padding: 12, backgroundColor: colors.grayLightest, borderRadius: 4, borderLeftWidth: 3, borderLeftColor: colors.primary, marginBottom: 10 },
  notesTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  notesText: { fontSize: 8, color: colors.gray, lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 25, left: 40, right: 40, borderTopWidth: 1, borderTopColor: colors.grayLight, paddingTop: 10, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7, color: colors.gray },
  footerThank: { fontSize: 9, fontFamily: "Helvetica-Bold", color: colors.primary },
});

const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return "KES 0.00";
  return `KES ${Number(amount).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const formatAddress = (address) => {
  if (!address) return "";
  const fromObject = (a) =>
    [a.street || a.line1, a.line2, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(", ");
  if (typeof address === "object") return fromObject(address);
  if (typeof address === "string") {
    const t = address.trim();
    if (t.startsWith("{") && t.endsWith("}")) {
      try { return fromObject(JSON.parse(t)); }
      catch {
        try {
          return fromObject(JSON.parse(t.replace(/([{,]\s*)(\w+):/g, '$1"$2":').replace(/'/g, '"')));
        } catch { return t; }
      }
    }
    return t;
  }
  return "";
};

const STATUS_COLORS = {
  draft: { bg: "#fef3c7", text: "#ca8a04" },
  confirmed: { bg: "#dbeafe", text: "#2563eb" },
  invoiced: { bg: "#dcfce7", text: "#16a34a" },
  cancelled: { bg: "#fee2e2", text: "#dc2626" },
};

// ============================================
// SALES ORDER PDF COMPONENT
// ============================================
export const SalesOrderPDF = ({ order, company }) => {
  const safeCompany = company || {};
  const statusColor = STATUS_COLORS[order.status] || STATUS_COLORS.draft;

  return (
    <Document title={`Sales Order ${order.orderNumber}`}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoSection}>
            <Image style={styles.logo} src={safeCompany.logo || "/qsl.png"} />
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
          <View style={styles.docHeader}>
            <Text style={styles.docTitle}>SALES ORDER</Text>
            <Text style={styles.docNumber}>{order.orderNumber}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
              <Text style={[styles.statusText, { color: statusColor.text }]}>
                {order.status?.toUpperCase() || "DRAFT"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Customer & Order Details */}
        <View style={styles.infoRow}>
          <View style={styles.customerBox}>
            <Text style={styles.label}>Customer</Text>
            <Text style={styles.valueBold}>{order.customer?.name}</Text>
            <Text style={styles.value}>
              {formatAddress(order.customer?.address)}
              {order.customer?.phone && `\n${order.customer.phone}`}
              {order.customer?.email && `\n${order.customer.email}`}
              {order.customer?.taxPin && `\nPIN: ${order.customer.taxPin}`}
            </Text>
          </View>
          <View style={styles.docDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Order Date</Text>
              <Text style={styles.valueBold}>{formatDate(order.orderDate)}</Text>
            </View>
            {order.expectedDeliveryDate && (
              <View style={styles.detailRow}>
                <Text style={styles.label}>Expected Delivery</Text>
                <Text style={styles.valueBold}>{formatDate(order.expectedDeliveryDate)}</Text>
              </View>
            )}
            {order.quoteRef?.quoteNumber && (
              <View style={styles.detailRow}>
                <Text style={styles.label}>From Quote</Text>
                <Text style={styles.value}>{order.quoteRef.quoteNumber}</Text>
              </View>
            )}
            {order.salesPerson?.name && (
              <View style={styles.detailRow}>
                <Text style={styles.label}>Sales Person</Text>
                <Text style={styles.value}>{order.salesPerson.name}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colNo]}>#</Text>
            <Text style={[styles.tableHeaderCell, styles.colDesc]}>Description</Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
            <Text style={[styles.tableHeaderCell, styles.colPrice]}>Unit Price</Text>
            <Text style={[styles.tableHeaderCell, styles.colAmount]}>Amount</Text>
          </View>
          {order.items?.map((item, i) => (
            <View key={i} style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}>
              <Text style={[styles.tableCell, styles.colNo]}>{item.lineNumber || i + 1}</Text>
              <View style={styles.colDesc}>
                <Text style={styles.tableCellBold}>
                  {item.product?.name || item.description}
                </Text>
                {item.product?.sku && (
                  <Text style={styles.tableCellSub}>SKU: {item.product.sku}</Text>
                )}
                {item.description && item.description !== item.product?.name && (
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
                {formatCurrency(item.amount ?? item.lineTotal)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsRow}>
          <View style={styles.totalsBox}>
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatCurrency(order.subtotal)}</Text>
            </View>
            {order.totalDiscount > 0 && (
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Discount</Text>
                <Text style={[styles.totalValue, { color: colors.success }]}>
                  -{formatCurrency(order.totalDiscount)}
                </Text>
              </View>
            )}
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>VAT (16%)</Text>
              <Text style={styles.totalValue}>{formatCurrency(order.taxAmount)}</Text>
            </View>
            <View style={styles.totalFinal}>
              <Text style={styles.totalLabelFinal}>TOTAL</Text>
              <Text style={styles.totalValueFinal}>{formatCurrency(order.total)}</Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {order.notes && (
          <View style={styles.notesSection}>
            <View style={styles.notesBox}>
              <Text style={styles.notesTitle}>Notes</Text>
              <Text style={styles.notesText}>{order.notes}</Text>
            </View>
          </View>
        )}

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

export default SalesOrderPDF;

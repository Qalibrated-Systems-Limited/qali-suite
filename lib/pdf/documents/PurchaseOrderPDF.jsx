"use client";

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

// ============================================
// COLOR PALETTE
// ============================================
const colors = {
  primary: "#eab308",
  primaryLight: "#fef9c3",
  primaryBorder: "#fde047",
  black: "#18181b",
  darkGray: "#3f3f46",
  gray: "#71717a",
  lightGray: "#a1a1aa",
  border: "#e4e4e7",
  bgLight: "#fafafa",
  bgMuted: "#f4f4f5",
  white: "#ffffff",
};

// ============================================
// STYLES - Compact & Balanced
// ============================================
const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 25,
    paddingBottom: 25,
    paddingHorizontal: 30,
    color: colors.darkGray,
    backgroundColor: colors.white,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 15,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  logoSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    
    height: 45,
    objectFit: "contain",
  },
  companyInfo: {
    maxWidth: 160,
  },
  companyName: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
    marginBottom: 1,
  },
  companyTagline: {
    fontSize: 7,
    color: colors.gray,
    marginBottom: 2,
  },
  companyDetails: {
    fontSize: 7,
    color: colors.gray,
    lineHeight: 1.3,
  },
  documentTitle: {
    textAlign: "right",
  },
  documentType: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    letterSpacing: 1,
  },
  documentNumber: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
    marginTop: 2,
  },
  documentDate: {
    fontSize: 7,
    color: colors.gray,
    marginTop: 1,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    alignSelf: "flex-end",
    marginTop: 4,
  },
  statusText: {
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Info Grid
  infoGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 15,
  },
  infoBox: {
    flex: 1,
    backgroundColor: colors.bgMuted,
    padding: 10,
    borderRadius: 3,
  },
  infoBoxHighlight: {
    flex: 1,
    backgroundColor: colors.primaryLight,
    padding: 10,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  infoBoxLabel: {
    fontSize: 6,
    color: colors.gray,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
  },
  infoBoxTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
    marginBottom: 2,
  },
  infoBoxText: {
    fontSize: 7,
    color: colors.darkGray,
    lineHeight: 1.4,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  infoRowLabel: {
    fontSize: 7,
    color: colors.gray,
  },
  infoRowValue: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
  },

  // Table
  table: {
    marginBottom: 12,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: colors.black,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 2,
  },
  tableHeaderCell: {
    color: colors.white,
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: "center",
    minHeight: 22,
  },
  tableRowAlt: {
    backgroundColor: colors.bgLight,
  },
  tableCell: {
    fontSize: 7,
    color: colors.darkGray,
  },
  tableCellBold: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
  },
  tableCellMono: {
    fontSize: 6,
    fontFamily: "Courier",
    color: colors.gray,
  },
  tableCellSmall: {
    fontSize: 6,
    color: colors.lightGray,
  },

  // Column widths
  colNo: { width: "5%" },
  colSku: { width: "12%" },
  colDesc: { width: "33%" },
  colQty: { width: "10%", textAlign: "center" },
  colRate: { width: "15%", textAlign: "right" },
  colVat: { width: "10%", textAlign: "right" },
  colAmount: { width: "15%", textAlign: "right" },

  // Summary Section
  summarySection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  notesBox: {
    width: "54%",
    paddingRight: 15,
  },
  notesLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.darkGray,
    marginBottom: 3,
  },
  notesText: {
    fontSize: 7,
    color: colors.gray,
    lineHeight: 1.5,
  },
  totalsBox: {
    width: "44%",
    backgroundColor: colors.bgMuted,
    borderRadius: 3,
    overflow: "hidden",
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  totalsRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalsLabel: {
    fontSize: 7,
    color: colors.gray,
  },
  totalsValue: {
    fontSize: 7,
    color: colors.black,
    textAlign: "right",
  },
  totalsValueMuted: {
    fontSize: 7,
    color: colors.gray,
    textAlign: "right",
  },
  totalsFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  totalsFinalLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
  },
  totalsFinalValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
  },

  // Terms
  termsSection: {
    marginBottom: 12,
    padding: 8,
    backgroundColor: colors.bgLight,
    borderRadius: 3,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
  },
  termsLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.darkGray,
    marginBottom: 3,
  },
  termsText: {
    fontSize: 6,
    color: colors.gray,
    lineHeight: 1.5,
  },

  // Authorization
  authSection: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginBottom: 12,
  },
  authBox: {
    flex: 1,
  },
  authLabel: {
    fontSize: 6,
    color: colors.gray,
    marginBottom: 18,
  },
  authLine: {
    borderTopWidth: 1,
    borderTopColor: colors.darkGray,
    paddingTop: 3,
  },
  authName: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
    minHeight: 10,
  },
  authTitle: {
    fontSize: 6,
    color: colors.gray,
  },
  authDate: {
    fontSize: 5,
    color: colors.lightGray,
    marginTop: 1,
  },

  // Footer - fixed at bottom of page
  footer: {
    position: "absolute",
    bottom: 25,
    left: 30,
    right: 30,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  footerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  footerLeft: {
    flex: 1,
  },
  footerCompany: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.darkGray,
    marginBottom: 1,
  },
  footerAddress: {
    fontSize: 6,
    color: colors.gray,
    lineHeight: 1.3,
  },
  footerCenter: {
    flex: 1,
    textAlign: "center",
  },
  footerContact: {
    fontSize: 6,
    color: colors.gray,
    lineHeight: 1.3,
  },
  footerRight: {
    flex: 1,
    textAlign: "right",
  },
  footerPin: {
    fontSize: 6,
    color: colors.gray,
    marginBottom: 2,
  },
  pageNumber: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.darkGray,
  },

});

// ============================================
// UTILITY FUNCTIONS
// ============================================
const formatCurrency = (amount, currency = "KES") => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return `${currency} 0.00`;
  }
  return `${currency} ${Number(amount).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (date) => {
  if (!date) return "-";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const getStatusColor = (status) => {
  const statusColors = {
    draft: { bg: "#f4f4f5", text: "#71717a" },
    sent: { bg: "#dbeafe", text: "#2563eb" },
    confirmed: { bg: "#d1fae5", text: "#059669" },
    partial: { bg: "#fef9c3", text: "#ca8a04" },
    received: { bg: "#dcfce7", text: "#16a34a" },
    cancelled: { bg: "#fee2e2", text: "#dc2626" },
    expired: { bg: "#fef3c7", text: "#d97706" },
  };
  return statusColors[status] || statusColors.draft;
};

const formatStatus = (status) => {
  if (!status) return "Draft";
  return status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
};

// Handle address in various formats: JSON string, JS object literal, or plain object
const formatAddress = (address) => {
  if (!address) return "";
  if (typeof address === "string") {
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(address);
      if (typeof parsed === "object" && parsed !== null) {
        const parts = [
          parsed.street,
          parsed.city,
          parsed.state,
          parsed.postalCode,
          parsed.country,
        ].filter(Boolean);
        return parts.join(", ");
      }
    } catch {
      // Check if it's a JS object literal format like {street: "...", city: "..."}
      if (address.startsWith("{") && address.includes(":")) {
        try {
          // Convert JS object literal to JSON by adding quotes around keys
          const jsonStr = address.replace(/(\w+):/g, '"$1":').replace(/'/g, '"');
          const parsed = JSON.parse(jsonStr);
          const parts = [
            parsed.street,
            parsed.city,
            parsed.state,
            parsed.postalCode,
            parsed.country,
          ].filter(Boolean);
          return parts.join(", ");
        } catch {
          return address; // Return as-is if parsing fails
        }
      }
      return address; // Return plain string as-is
    }
  }
  // Handle plain object
  if (typeof address === "object") {
    const parts = [
      address.street,
      address.city,
      address.state,
      address.postalCode,
      address.country,
    ].filter(Boolean);
    return parts.join(", ");
  }
  return String(address);
};

// ============================================
// PURCHASE ORDER PDF COMPONENT
// ============================================
export const PurchaseOrderPDF = ({ data, company }) => {
  // Use real company info from props with safe fallback
  const safeCompany = company || {};
  const companyAddress =
    safeCompany.fullAddress || formatAddress(safeCompany.address) || "";

  // Destructure data matching SCHEMA STRUCTURE
  const {
    poNumber = "PO-DRAFT",
    poDate,
    expectedDeliveryDate,
    validUntil,
    supplier = {},
    whtApplicable = false,
    whtRate = 0,
    lines = [],
    amounts = {},
    currency = "KES",
    status = "draft",
    deliveryAddress,
    deliveryInstructions,
    notes,
    termsAndConditions,
    createdBy,
    sentBy,
    confirmedBy,
  } = data || {};

  const {
    subtotal = 0,
    vat: vatAmount = 0,
    total = 0,
    wht: whtAmount = 0,
    netPayable = 0,
  } = amounts;

  const statusColor = getStatusColor(status);
  const hasLines = lines && lines.length > 0;
  const lineCount = lines?.length || 0;

  // Only use multi-page mode when items are truly many (>18)
  const isMultiPage = lineCount > 18;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.logoSection}>
            <Image src={safeCompany.logo || "/qsl.png"} style={styles.logo} />
            <View style={styles.companyInfo}>
              <Text style={styles.companyName}>
                {safeCompany.name || "Company Name"}
              </Text>
              {safeCompany.tagline && (
                <Text style={styles.companyTagline}>{safeCompany.tagline}</Text>
              )}
              {companyAddress && (
                <Text style={styles.companyDetails}>{companyAddress}</Text>
              )}
              {(safeCompany.phone || safeCompany.email) && (
                <Text style={styles.companyDetails}>
                  {[safeCompany.phone, safeCompany.email]
                    .filter(Boolean)
                    .join(" • ")}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.documentTitle}>
            <Text style={styles.documentType}>PURCHASE ORDER</Text>
            <Text style={styles.documentNumber}>{poNumber}</Text>
            <Text style={styles.documentDate}>
              Date: {formatDate(poDate || new Date())}
            </Text>
            <View
              style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}
            >
              <Text style={[styles.statusText, { color: statusColor.text }]}>
                {formatStatus(status)}
              </Text>
            </View>
          </View>
        </View>

        {/* INFO GRID */}
        <View style={styles.infoGrid}>
          {/* Supplier */}
          <View style={styles.infoBox}>
            <Text style={styles.infoBoxLabel}>Supplier</Text>
            <Text style={styles.infoBoxTitle}>{supplier.name || "-"}</Text>
            {supplier.address && (
              <Text style={styles.infoBoxText}>{supplier.address}</Text>
            )}
            {supplier.taxPin && (
              <Text style={styles.infoBoxText}>PIN: {supplier.taxPin}</Text>
            )}
            {supplier.phone && (
              <Text style={styles.infoBoxText}>Tel: {supplier.phone}</Text>
            )}
            {supplier.email && (
              <Text style={styles.infoBoxText}>{supplier.email}</Text>
            )}
          </View>

          {/* Deliver To */}
          <View style={styles.infoBox}>
            <Text style={styles.infoBoxLabel}>Deliver To</Text>
            <Text style={styles.infoBoxTitle}>
              {safeCompany.name || "Company Name"}
            </Text>
            <Text style={styles.infoBoxText}>
              {deliveryAddress || companyAddress}
            </Text>
            {deliveryInstructions && (
              <Text
                style={[
                  styles.infoBoxText,
                  { marginTop: 3, fontStyle: "italic", fontSize: 6 },
                ]}
              >
                Note: {deliveryInstructions}
              </Text>
            )}
          </View>

          {/* PO Details */}
          <View style={styles.infoBoxHighlight}>
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>PO Date:</Text>
              <Text style={styles.infoRowValue}>
                {formatDate(poDate || new Date())}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Expected:</Text>
              <Text style={styles.infoRowValue}>
                {formatDate(expectedDeliveryDate)}
              </Text>
            </View>
            {validUntil && (
              <View style={styles.infoRow}>
                <Text style={styles.infoRowLabel}>Valid Until:</Text>
                <Text style={styles.infoRowValue}>
                  {formatDate(validUntil)}
                </Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Currency:</Text>
              <Text style={styles.infoRowValue}>{currency}</Text>
            </View>
            {whtApplicable && (
              <View style={styles.infoRow}>
                <Text style={styles.infoRowLabel}>WHT Rate:</Text>
                <Text style={styles.infoRowValue}>{whtRate}%</Text>
              </View>
            )}
          </View>
        </View>

        {/* TABLE */}
        <View style={styles.table}>
          {/* Table Header - only fixed for multi-page */}
          <View style={styles.tableHeader} fixed={isMultiPage}>
            <Text style={[styles.tableHeaderCell, styles.colNo]}>#</Text>
            <Text style={[styles.tableHeaderCell, styles.colSku]}>SKU</Text>
            <Text style={[styles.tableHeaderCell, styles.colDesc]}>
              Description
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
            <Text style={[styles.tableHeaderCell, styles.colRate]}>
              Unit Price
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colVat]}>VAT %</Text>
            <Text style={[styles.tableHeaderCell, styles.colAmount]}>
              Amount
            </Text>
          </View>

          {/* Table Rows */}
          {hasLines ? (
            lines.map((line, index) => {
              const lineNum = line.lineNumber || index + 1;
              const sku = line.product?.sku || "-";
              const description = line.description || line.product?.name || "-";
              const qty = line.quantity || 0;
              const unit = line.unit || "pcs";
              const unitPrice = line.unitPrice || 0;
              const vatRate = line.vat?.rate ?? 16;
              const amount = line.amount || qty * unitPrice;

              return (
                <View
                  key={line._id || index}
                  style={[
                    styles.tableRow,
                    index % 2 === 1 ? styles.tableRowAlt : {},
                  ]}
                  wrap={false}
                >
                  <Text style={[styles.tableCellSmall, styles.colNo]}>
                    {lineNum}
                  </Text>
                  <Text style={[styles.tableCellMono, styles.colSku]}>
                    {sku}
                  </Text>
                  <View style={styles.colDesc}>
                    <Text style={styles.tableCell}>{description}</Text>
                    {line.account?.name && (
                      <Text style={styles.tableCellSmall}>
                        A/C: {line.account.code} {line.account.name}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.tableCell, styles.colQty]}>
                    {qty} {unit}
                  </Text>
                  <Text style={[styles.tableCell, styles.colRate]}>
                    {formatCurrency(unitPrice, currency)}
                  </Text>
                  <Text
                    style={[
                      styles.tableCell,
                      styles.colVat,
                      { color: colors.gray },
                    ]}
                  >
                    {vatRate}%
                  </Text>
                  <Text style={[styles.tableCellBold, styles.colAmount]}>
                    {formatCurrency(amount, currency)}
                  </Text>
                </View>
              );
            })
          ) : (
            <View style={styles.tableRow}>
              <Text
                style={{
                  width: "100%",
                  textAlign: "center",
                  color: colors.lightGray,
                  fontStyle: "italic",
                  fontSize: 8,
                  paddingVertical: 10,
                }}
              >
                No items added to this order
              </Text>
            </View>
          )}
        </View>

        {/* SUMMARY SECTION */}
        <View style={styles.summarySection} wrap={false}>
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Notes & Instructions</Text>
            <Text style={styles.notesText}>
              {notes ||
                "Please reference PO number on all correspondence, delivery notes, and invoices. Goods to be delivered during business hours (8AM - 5PM)."}
            </Text>
          </View>

          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal:</Text>
              <Text style={styles.totalsValue}>
                {formatCurrency(subtotal, currency)}
              </Text>
            </View>
            <View style={[styles.totalsRow, styles.totalsRowBorder]}>
              <Text style={styles.totalsLabel}>VAT:</Text>
              <Text style={styles.totalsValue}>
                {formatCurrency(vatAmount, currency)}
              </Text>
            </View>
            <View style={[styles.totalsRow, styles.totalsRowBorder]}>
              <Text style={styles.totalsLabel}>Gross Total:</Text>
              <Text style={styles.totalsValue}>
                {formatCurrency(total, currency)}
              </Text>
            </View>
            {whtApplicable && whtAmount > 0 && (
              <View style={[styles.totalsRow, styles.totalsRowBorder]}>
                <Text style={styles.totalsLabel}>Less WHT ({whtRate}%):</Text>
                <Text style={styles.totalsValueMuted}>
                  ({formatCurrency(whtAmount, currency)})
                </Text>
              </View>
            )}
            <View style={styles.totalsFinal}>
              <Text style={styles.totalsFinalLabel}>
                {whtApplicable ? "Net Payable:" : "Total:"}
              </Text>
              <Text style={styles.totalsFinalValue}>
                {formatCurrency(whtApplicable ? netPayable : total, currency)}
              </Text>
            </View>
          </View>
        </View>

        {/* TERMS & CONDITIONS */}
        {termsAndConditions && (
          <View style={styles.termsSection} wrap={false}>
            <Text style={styles.termsLabel}>Terms & Conditions</Text>
            <Text style={styles.termsText}>{termsAndConditions}</Text>
          </View>
        )}

        {/* AUTHORIZATION */}
        <View style={styles.authSection} wrap={false}>
          <View style={styles.authBox}>
            <Text style={styles.authLabel}>Prepared By:</Text>
            <View style={styles.authLine}>
              <Text style={styles.authName}>
                {createdBy?.name || "_________________"}
              </Text>
              <Text style={styles.authTitle}>Procurement Officer</Text>
              {createdBy?.name && (
                <Text style={styles.authDate}>
                  {formatDate(data?.createdAt)}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.authBox}>
            <Text style={styles.authLabel}>Sent By:</Text>
            <View style={styles.authLine}>
              <Text style={styles.authName}>
                {sentBy?.name || "_________________"}
              </Text>
              <Text style={styles.authTitle}>Procurement Manager</Text>
              {sentBy?.name && (
                <Text style={styles.authDate}>{formatDate(data?.sentAt)}</Text>
              )}
            </View>
          </View>
          <View style={styles.authBox}>
            <Text style={styles.authLabel}>Authorized By:</Text>
            <View style={styles.authLine}>
              <Text style={styles.authName}>
                {confirmedBy?.name || "_________________"}
              </Text>
              <Text style={styles.authTitle}>Finance Manager</Text>
              {confirmedBy?.name && (
                <Text style={styles.authDate}>
                  {formatDate(data?.confirmedAt)}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* FOOTER - Fixed at bottom of every page */}
        <View style={styles.footer} fixed>
          <View style={styles.footerContent}>
            <View style={styles.footerLeft}>
              <Text style={styles.footerCompany}>
                {safeCompany.name || "Company Name"}
              </Text>
              {companyAddress && (
                <Text style={styles.footerAddress}>{companyAddress}</Text>
              )}
            </View>
            <View style={styles.footerCenter}>
              <Text style={styles.footerContact}>
                {[
                  safeCompany.phone && `Tel: ${safeCompany.phone}`,
                  safeCompany.email,
                  safeCompany.website,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </Text>
            </View>
            <View style={styles.footerRight}>
              {safeCompany.taxPin && (
                <Text style={styles.footerPin}>PIN: {safeCompany.taxPin}</Text>
              )}
              <Text
                style={styles.pageNumber}
                render={({ pageNumber, totalPages }) =>
                  `Page ${pageNumber} of ${totalPages}`
                }
              />
            </View>
          </View>
        </View>

      </Page>
    </Document>
  );
};

export default PurchaseOrderPDF;

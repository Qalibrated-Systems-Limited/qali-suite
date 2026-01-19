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
  success: "#16a34a",
  successLight: "#dcfce7",
  warning: "#ca8a04",
  warningLight: "#fef9c3",
  danger: "#dc2626",
  dangerLight: "#fee2e2",
  info: "#2563eb",
  infoLight: "#dbeafe",
};

// ============================================
// STYLES
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
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  logoSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    width: 60,
    height: 60,
    objectFit: "contain",
  },
  companyInfo: {
    maxWidth: 170,
  },
  companyName: {
    fontSize: 13,
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
    lineHeight: 1.4,
  },
  documentTitle: {
    textAlign: "right",
  },
  documentType: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    letterSpacing: 1.5,
  },
  documentNumber: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
    marginTop: 2,
  },
  documentDate: {
    fontSize: 7,
    color: colors.gray,
    marginTop: 1,
  },

  // Status badges
  statusRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 6,
    marginTop: 6,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
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
    marginBottom: 16,
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
    marginBottom: 14,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: colors.black,
    paddingVertical: 7,
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
    paddingVertical: 7,
    paddingHorizontal: 8,
    alignItems: "center",
    minHeight: 26,
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
  itemTypeBadge: {
    fontSize: 5,
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 2,
    marginTop: 2,
  },

  // Column widths for invoice
  colNo: { width: "4%" },
  colDesc: { width: "36%" },
  colQty: { width: "10%", textAlign: "center" },
  colRate: { width: "15%", textAlign: "right" },
  colDisc: { width: "10%", textAlign: "right" },
  colVat: { width: "10%", textAlign: "right" },
  colAmount: { width: "15%", textAlign: "right" },

  // Summary Section
  summarySection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  notesBox: {
    width: "52%",
    paddingRight: 12,
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
    width: "46%",
    backgroundColor: colors.bgMuted,
    borderRadius: 3,
    overflow: "hidden",
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
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
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  totalsFinalLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
  },
  totalsFinalValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
  },

  // Payment Info Section
  paymentSection: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  paymentBox: {
    flex: 1,
    padding: 10,
    backgroundColor: colors.bgLight,
    borderRadius: 3,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  paymentBoxDanger: {
    flex: 1,
    padding: 10,
    backgroundColor: colors.dangerLight,
    borderRadius: 3,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  paymentBoxSuccess: {
    flex: 1,
    padding: 10,
    backgroundColor: colors.successLight,
    borderRadius: 3,
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },
  paymentLabel: {
    fontSize: 6,
    color: colors.gray,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
    fontFamily: "Helvetica-Bold",
  },
  paymentValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
  },
  paymentValueDanger: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: colors.danger,
  },
  paymentValueSuccess: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: colors.success,
  },
  paymentSubtext: {
    fontSize: 6,
    color: colors.gray,
    marginTop: 2,
  },

  // Bank Details
  bankSection: {
    marginBottom: 14,
    padding: 10,
    backgroundColor: colors.bgMuted,
    borderRadius: 3,
  },
  bankTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.darkGray,
    marginBottom: 6,
  },
  bankGrid: {
    flexDirection: "row",
    gap: 20,
  },
  bankColumn: {
    flex: 1,
  },
  bankRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  bankLabel: {
    fontSize: 7,
    color: colors.gray,
    width: 70,
  },
  bankValue: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.black,
    flex: 1,
  },

  // Terms
  termsSection: {
    marginBottom: 12,
    padding: 8,
    backgroundColor: colors.bgLight,
    borderRadius: 3,
    borderLeftWidth: 2,
    borderLeftColor: colors.gray,
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

  // Footer
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    marginTop: 8,
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

  // Thank you message
  thankYou: {
    textAlign: "center",
    marginBottom: 10,
    paddingVertical: 8,
  },
  thankYouText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
  thankYouSubtext: {
    fontSize: 7,
    color: colors.gray,
    marginTop: 2,
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
    draft: { bg: colors.bgMuted, text: colors.gray },
    sent: { bg: colors.infoLight, text: colors.info },
    completed: { bg: colors.successLight, text: colors.success },
    cancelled: { bg: colors.dangerLight, text: colors.danger },
    void: { bg: colors.dangerLight, text: colors.danger },
  };
  return statusColors[status] || statusColors.draft;
};

const getPaymentStatusColor = (status) => {
  const statusColors = {
    unpaid: { bg: colors.warningLight, text: colors.warning },
    partial: { bg: colors.infoLight, text: colors.info },
    paid: { bg: colors.successLight, text: colors.success },
    overdue: { bg: colors.dangerLight, text: colors.danger },
  };
  return statusColors[status] || statusColors.unpaid;
};

const formatStatus = (status) => {
  if (!status) return "Draft";
  return status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
};

// ============================================
// INVOICE PDF COMPONENT
// ============================================
export const InvoicePDF = ({ data, company, bankDetails }) => {
  const companyInfo = company || {
    name: "QSL Technologies Ltd",
    tagline: "Quality Systems & Logistics",
    address: "Industrial Area, Enterprise Road",
    city: "Nairobi, Kenya",
    postalCode: "P.O. Box 12345-00100",
    phone: "+254 700 123 456",
    email: "accounts@qsl.co.ke",
    website: "www.qsl.co.ke",
    pin: "P051234567X",
  };

  const bankInfo = bankDetails || {
    bankName: "Kenya Commercial Bank",
    accountName: "QSL Technologies Ltd",
    accountNumber: "1234567890",
    branchName: "Westlands Branch",
    branchCode: "001",
    swiftCode: "KCABORBY",
    mpesaPaybill: "123456",
    mpesaAccountNumber: "Invoice Number",
  };

  // Destructure data matching SCHEMA STRUCTURE
  const {
    invoiceNumber = "INV-DRAFT",
    invoiceDate,
    dueDate,
    customer = {},
    items = [],
    subtotal = 0,
    totalDiscount = 0,
    taxAmount = 0,
    total = 0,
    currency = "KES",
    totalCOGS = 0,
    grossProfit = 0,
    grossMarginPercentage = 0,
    paymentStatus = "unpaid",
    amountPaid = 0,
    amountDue = 0,
    status = "draft",
    paymentTerms = "Net 30",
    referenceNumber,
    purchaseOrderNumber,
    quoteRef,
    notes,
    termsAndConditions,
    createdBy,
  } = data || {};

  const statusColor = getStatusColor(status);
  const paymentColor = getPaymentStatusColor(paymentStatus);
  const hasItems = items && items.length > 0;
  const itemCount = items?.length || 0;
  const isMultiPage = itemCount > 15;
  const isOverdue =
    paymentStatus !== "paid" &&
    status === "completed" &&
    dueDate &&
    new Date() > new Date(dueDate);
  const hasDiscount = totalDiscount > 0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.logoSection}>
            <Image src="/qsl.png" style={styles.logo} />
            <View style={styles.companyInfo}>
              <Text style={styles.companyName}>{companyInfo.name}</Text>
              {companyInfo.tagline && (
                <Text style={styles.companyTagline}>{companyInfo.tagline}</Text>
              )}
              <Text style={styles.companyDetails}>
                {companyInfo.address}
                {"\n"}
                {companyInfo.city}
              </Text>
            </View>
          </View>
          <View style={styles.documentTitle}>
            <Text style={styles.documentType}>INVOICE</Text>
            <Text style={styles.documentNumber}>{invoiceNumber}</Text>
            <Text style={styles.documentDate}>
              Date: {formatDate(invoiceDate || new Date())}
            </Text>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: statusColor.bg },
                ]}
              >
                <Text style={[styles.statusText, { color: statusColor.text }]}>
                  {formatStatus(status)}
                </Text>
              </View>
              {status === "completed" && (
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: paymentColor.bg },
                  ]}
                >
                  <Text
                    style={[styles.statusText, { color: paymentColor.text }]}
                  >
                    {isOverdue ? "OVERDUE" : formatStatus(paymentStatus)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* INFO GRID */}
        <View style={styles.infoGrid}>
          {/* Bill To - Customer */}
          <View style={styles.infoBox}>
            <Text style={styles.infoBoxLabel}>Bill To</Text>
            <Text style={styles.infoBoxTitle}>{customer.name || "-"}</Text>
            {customer.address && (
              <Text style={styles.infoBoxText}>{customer.address}</Text>
            )}
            {customer.taxPin && (
              <Text style={styles.infoBoxText}>PIN: {customer.taxPin}</Text>
            )}
            {customer.phone && (
              <Text style={styles.infoBoxText}>Tel: {customer.phone}</Text>
            )}
            {customer.email && (
              <Text style={styles.infoBoxText}>{customer.email}</Text>
            )}
          </View>

          {/* Ship To / Delivery (same as customer for now) */}
          <View style={styles.infoBox}>
            <Text style={styles.infoBoxLabel}>Ship To</Text>
            <Text style={styles.infoBoxTitle}>{customer.name || "-"}</Text>
            {customer.address && (
              <Text style={styles.infoBoxText}>{customer.address.country}</Text>
            )}
            {customer.phone && (
              <Text style={styles.infoBoxText}>Tel: {customer.phone}</Text>
            )}
          </View>

          {/* Invoice Details */}
          <View style={styles.infoBoxHighlight}>
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Invoice Date:</Text>
              <Text style={styles.infoRowValue}>
                {formatDate(invoiceDate || new Date())}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Due Date:</Text>
              <Text
                style={[
                  styles.infoRowValue,
                  isOverdue && { color: colors.danger },
                ]}
              >
                {formatDate(dueDate)}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Payment Terms:</Text>
              <Text style={styles.infoRowValue}>{paymentTerms}</Text>
            </View>
            {purchaseOrderNumber && (
              <View style={styles.infoRow}>
                <Text style={styles.infoRowLabel}>PO Number:</Text>
                <Text style={styles.infoRowValue}>{purchaseOrderNumber}</Text>
              </View>
            )}
            {quoteRef?.quoteNumber && (
              <View style={styles.infoRow}>
                <Text style={styles.infoRowLabel}>Quote Ref:</Text>
                <Text style={styles.infoRowValue}>{quoteRef.quoteNumber}</Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Currency:</Text>
              <Text style={styles.infoRowValue}>{currency}</Text>
            </View>
          </View>
        </View>

        {/* TABLE */}
        <View style={styles.table}>
          {/* Table Header */}
          <View style={styles.tableHeader} fixed={isMultiPage}>
            <Text style={[styles.tableHeaderCell, styles.colNo]}>#</Text>
            <Text style={[styles.tableHeaderCell, styles.colDesc]}>
              Description
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
            <Text style={[styles.tableHeaderCell, styles.colRate]}>
              Unit Price
            </Text>
            {hasDiscount && (
              <Text style={[styles.tableHeaderCell, styles.colDisc]}>Disc</Text>
            )}
            <Text style={[styles.tableHeaderCell, styles.colVat]}>VAT</Text>
            <Text style={[styles.tableHeaderCell, styles.colAmount]}>
              Amount
            </Text>
          </View>

          {/* Table Rows */}
          {hasItems ? (
            items.map((item, index) => {
              const isProduct = item.itemType === "product";
              const description =
                item.description || item.productName || "Item";
              const qty = item.quantity || 0;
              const unit = item.unit || "pcs";
              const unitPrice = item.unitPrice || 0;
              const discountAmt = item.discountAmount || 0;
              const taxRate = item.taxRate ?? 16;
              const amount = item.amount || qty * unitPrice - discountAmt;

              return (
                <View
                  key={item._id || index}
                  style={[
                    styles.tableRow,
                    index % 2 === 1 ? styles.tableRowAlt : {},
                  ]}
                  wrap={false}
                >
                  <Text style={[styles.tableCellSmall, styles.colNo]}>
                    {index + 1}
                  </Text>
                  <View style={styles.colDesc}>
                    <Text style={styles.tableCell}>{description}</Text>
                    {isProduct && item.productSKU && (
                      <Text style={styles.tableCellMono}>
                        SKU: {item.productSKU}
                      </Text>
                    )}
                    <View
                      style={[
                        styles.itemTypeBadge,
                        {
                          backgroundColor: isProduct
                            ? colors.infoLight
                            : colors.successLight,
                          alignSelf: "flex-start",
                        },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 5,
                          color: isProduct ? colors.info : colors.success,
                        }}
                      >
                        {isProduct ? "PRODUCT" : "SERVICE"}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.tableCell, styles.colQty]}>
                    {qty} {unit}
                  </Text>
                  <Text style={[styles.tableCell, styles.colRate]}>
                    {formatCurrency(unitPrice, currency)}
                  </Text>
                  {hasDiscount && (
                    <Text
                      style={[
                        styles.tableCell,
                        styles.colDisc,
                        {
                          color: discountAmt > 0 ? colors.danger : colors.gray,
                        },
                      ]}
                    >
                      {discountAmt > 0
                        ? `(${formatCurrency(discountAmt, currency)})`
                        : "-"}
                    </Text>
                  )}
                  <Text
                    style={[
                      styles.tableCell,
                      styles.colVat,
                      { color: colors.gray },
                    ]}
                  >
                    {taxRate}%
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
                No items on this invoice
              </Text>
            </View>
          )}
        </View>

        {/* SUMMARY SECTION */}
        <View style={styles.summarySection} wrap={false}>
          <View style={styles.notesBox}>
            {notes && (
              <>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notesText}>{notes}</Text>
              </>
            )}
            {!notes && (
              <>
                <Text style={styles.notesLabel}>Payment Instructions</Text>
                <Text style={styles.notesText}>
                  Please reference invoice number {invoiceNumber} on all
                  payments. Payment is due by {formatDate(dueDate)}.
                </Text>
              </>
            )}
          </View>

          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal:</Text>
              <Text style={styles.totalsValue}>
                {formatCurrency(subtotal, currency)}
              </Text>
            </View>
            {hasDiscount && (
              <View style={[styles.totalsRow, styles.totalsRowBorder]}>
                <Text style={styles.totalsLabel}>Discount:</Text>
                <Text style={[styles.totalsValue, { color: colors.danger }]}>
                  ({formatCurrency(totalDiscount, currency)})
                </Text>
              </View>
            )}
            <View style={[styles.totalsRow, styles.totalsRowBorder]}>
              <Text style={styles.totalsLabel}>VAT (16%):</Text>
              <Text style={styles.totalsValue}>
                {formatCurrency(taxAmount, currency)}
              </Text>
            </View>
            <View style={styles.totalsFinal}>
              <Text style={styles.totalsFinalLabel}>Total:</Text>
              <Text style={styles.totalsFinalValue}>
                {formatCurrency(total, currency)}
              </Text>
            </View>
            {amountPaid > 0 && (
              <>
                <View
                  style={[styles.totalsRow, { backgroundColor: colors.white }]}
                >
                  <Text style={styles.totalsLabel}>Amount Paid:</Text>
                  <Text style={[styles.totalsValue, { color: colors.success }]}>
                    ({formatCurrency(amountPaid, currency)})
                  </Text>
                </View>
                <View
                  style={[
                    styles.totalsRow,
                    {
                      backgroundColor: isOverdue
                        ? colors.dangerLight
                        : colors.warningLight,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.totalsLabel,
                      { fontFamily: "Helvetica-Bold" },
                    ]}
                  >
                    Amount Due:
                  </Text>
                  <Text
                    style={[
                      styles.totalsValue,
                      {
                        fontFamily: "Helvetica-Bold",
                        color: isOverdue ? colors.danger : colors.warning,
                      },
                    ]}
                  >
                    {formatCurrency(amountDue, currency)}
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* PAYMENT STATUS BOXES */}
        {status === "completed" && (
          <View style={styles.paymentSection} wrap={false}>
            <View
              style={
                paymentStatus === "paid"
                  ? styles.paymentBoxSuccess
                  : isOverdue
                  ? styles.paymentBoxDanger
                  : styles.paymentBox
              }
            >
              <Text style={styles.paymentLabel}>Amount Due</Text>
              <Text
                style={
                  paymentStatus === "paid"
                    ? styles.paymentValueSuccess
                    : isOverdue
                    ? styles.paymentValueDanger
                    : styles.paymentValue
                }
              >
                {paymentStatus === "paid"
                  ? "PAID IN FULL"
                  : formatCurrency(amountDue, currency)}
              </Text>
              {paymentStatus !== "paid" && (
                <Text style={styles.paymentSubtext}>
                  Due: {formatDate(dueDate)}
                  {isOverdue && " (OVERDUE)"}
                </Text>
              )}
            </View>

            <View style={styles.paymentBox}>
              <Text style={styles.paymentLabel}>Payment Method</Text>
              <Text style={styles.paymentValue}>Bank / M-Pesa</Text>
              <Text style={styles.paymentSubtext}>See details below</Text>
            </View>
          </View>
        )}

        {/* BANK DETAILS */}
        {status === "completed" && paymentStatus !== "paid" && (
          <View style={styles.bankSection} wrap={false}>
            <Text style={styles.bankTitle}>Payment Details</Text>
            <View style={styles.bankGrid}>
              <View style={styles.bankColumn}>
                <Text
                  style={[
                    styles.notesLabel,
                    { marginBottom: 4, color: colors.gray },
                  ]}
                >
                  Bank Transfer
                </Text>
                <View style={styles.bankRow}>
                  <Text style={styles.bankLabel}>Bank:</Text>
                  <Text style={styles.bankValue}>{bankInfo.bankName}</Text>
                </View>
                <View style={styles.bankRow}>
                  <Text style={styles.bankLabel}>Account Name:</Text>
                  <Text style={styles.bankValue}>{bankInfo.accountName}</Text>
                </View>
                <View style={styles.bankRow}>
                  <Text style={styles.bankLabel}>Account No:</Text>
                  <Text style={styles.bankValue}>{bankInfo.accountNumber}</Text>
                </View>
                <View style={styles.bankRow}>
                  <Text style={styles.bankLabel}>Branch:</Text>
                  <Text style={styles.bankValue}>{bankInfo.branchName}</Text>
                </View>
                <View style={styles.bankRow}>
                  <Text style={styles.bankLabel}>Swift Code:</Text>
                  <Text style={styles.bankValue}>{bankInfo.swiftCode}</Text>
                </View>
              </View>
              <View style={styles.bankColumn}>
                <Text
                  style={[
                    styles.notesLabel,
                    { marginBottom: 4, color: colors.gray },
                  ]}
                >
                  M-Pesa
                </Text>
                <View style={styles.bankRow}>
                  <Text style={styles.bankLabel}>Paybill:</Text>
                  <Text style={styles.bankValue}>{bankInfo.mpesaPaybill}</Text>
                </View>
                <View style={styles.bankRow}>
                  <Text style={styles.bankLabel}>Account No:</Text>
                  <Text style={styles.bankValue}>{invoiceNumber}</Text>
                </View>
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.bankLabel, { fontStyle: "italic" }]}>
                    Reference: {invoiceNumber}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* TERMS & CONDITIONS */}
        {termsAndConditions && (
          <View style={styles.termsSection} wrap={false}>
            <Text style={styles.termsLabel}>Terms & Conditions</Text>
            <Text style={styles.termsText}>{termsAndConditions}</Text>
          </View>
        )}

        {/* THANK YOU MESSAGE */}
        <View style={styles.thankYou} wrap={false}>
          <Text style={styles.thankYouText}>Thank you for your business!</Text>
          <Text style={styles.thankYouSubtext}>
            Questions? Contact us at {companyInfo.email} or {companyInfo.phone}
          </Text>
        </View>

        {/* FOOTER */}
        <View style={styles.footer} wrap={false}>
          <View style={styles.footerContent}>
            <View style={styles.footerLeft}>
              <Text style={styles.footerCompany}>{companyInfo.name}</Text>
              <Text style={styles.footerAddress}>
                {companyInfo.address}, {companyInfo.city}
                {companyInfo.postalCode && ` • ${companyInfo.postalCode}`}
              </Text>
            </View>
            <View style={styles.footerCenter}>
              <Text style={styles.footerContact}>
                Tel: {companyInfo.phone} • {companyInfo.email}
                {companyInfo.website && ` • ${companyInfo.website}`}
              </Text>
            </View>
            <View style={styles.footerRight}>
              <Text style={styles.footerPin}>PIN: {companyInfo.pin}</Text>
              <Text
                style={styles.pageNumber}
                render={({ pageNumber, totalPages }) =>
                  totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : ""
                }
              />
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
};

export default InvoicePDF;

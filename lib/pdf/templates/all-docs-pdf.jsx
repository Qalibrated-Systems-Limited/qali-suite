"use client";

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                     PROFESSIONAL PDF TEMPLATE SYSTEM                          ║
// ║                     QSL Technologies Ltd - ERP Documents                      ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

// ============================================
// DESIGN TOKENS - Single source of truth
// ============================================
const tokens = {
  colors: {
    // Brand
    primary: "#eab308",
    primaryDark: "#ca8a04",
    primaryLight: "#fef9c3",

    // Neutrals
    black: "#0f0f0f",
    gray900: "#171717",
    gray800: "#262626",
    gray700: "#404040",
    gray600: "#525252",
    gray500: "#737373",
    gray400: "#a3a3a3",
    gray300: "#d4d4d4",
    gray200: "#e5e5e5",
    gray100: "#f5f5f5",
    gray50: "#fafafa",
    white: "#ffffff",

    // Semantic
    success: "#16a34a",
    successLight: "#dcfce7",
    warning: "#d97706",
    warningLight: "#fef3c7",
    danger: "#dc2626",
    dangerLight: "#fee2e2",
    info: "#2563eb",
    infoLight: "#dbeafe",
  },

  spacing: {
    xs: 2,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 24,
  },

  fontSize: {
    xs: 6,
    sm: 7,
    base: 8,
    md: 9,
    lg: 10,
    xl: 12,
    xxl: 16,
    huge: 20,
  },

  borderRadius: {
    sm: 2,
    md: 3,
    lg: 4,
  },
};

const { colors, spacing, fontSize, borderRadius } = tokens;

// ============================================
// SHARED STYLES
// ============================================
const baseStyles = StyleSheet.create({
  // Page
  page: {
    fontFamily: "Helvetica",
    fontSize: fontSize.base,
    padding: 24,
    paddingBottom: 60,
    color: colors.gray700,
    backgroundColor: colors.white,
  },

  // ═══════════════════════════════════════════
  // HEADER SECTION
  // ═══════════════════════════════════════════
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },

  logoArea: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },

  logo: {
    height: 48,
  },

  companyBlock: {
    maxWidth: 160,
  },

  companyName: {
    fontSize: fontSize.xl,
    fontFamily: "Helvetica-Bold",
    color: colors.gray900,
    marginBottom: 1,
  },

  companyTagline: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  companyContact: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    lineHeight: 1.4,
  },

  // Document Title Area
  titleArea: {
    textAlign: "right",
    alignItems: "flex-end",
  },

  docType: {
    fontSize: fontSize.huge,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    letterSpacing: 2,
    marginBottom: spacing.xs,
  },

  docNumber: {
    fontSize: fontSize.lg,
    fontFamily: "Helvetica-Bold",
    color: colors.gray900,
    marginBottom: spacing.xs,
  },

  docMeta: {
    fontSize: fontSize.sm,
    color: colors.gray500,
  },

  // Status Badges
  badgeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    justifyContent: "flex-end",
  },

  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },

  badgeText: {
    fontSize: fontSize.xs,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // ═══════════════════════════════════════════
  // INFO CARDS SECTION
  // ═══════════════════════════════════════════
  infoRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },

  infoCard: {
    flex: 1,
    backgroundColor: colors.gray50,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.gray300,
  },

  infoCardAccent: {
    flex: 1,
    backgroundColor: colors.primaryLight,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },

  infoLabel: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    fontFamily: "Helvetica-Bold",
  },

  infoTitle: {
    fontSize: fontSize.md,
    fontFamily: "Helvetica-Bold",
    color: colors.gray900,
    marginBottom: spacing.xs,
  },

  infoText: {
    fontSize: fontSize.sm,
    color: colors.gray600,
    lineHeight: 1.4,
  },

  infoLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },

  infoLineLabel: {
    fontSize: fontSize.sm,
    color: colors.gray500,
  },

  infoLineValue: {
    fontSize: fontSize.sm,
    fontFamily: "Helvetica-Bold",
    color: colors.gray800,
  },

  // ═══════════════════════════════════════════
  // TABLE SECTION
  // ═══════════════════════════════════════════
  table: {
    marginBottom: spacing.lg,
  },

  tableHeader: {
    flexDirection: "row",
    backgroundColor: colors.gray900,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderTopLeftRadius: borderRadius.md,
    borderTopRightRadius: borderRadius.md,
  },

  tableHeaderCell: {
    fontSize: fontSize.xs,
    fontFamily: "Helvetica-Bold",
    color: colors.white,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },

  tableRow: {
    flexDirection: "row",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray200,
    alignItems: "center",
    minHeight: 28,
  },

  tableRowAlt: {
    backgroundColor: colors.gray50,
  },

  tableCell: {
    fontSize: fontSize.sm,
    color: colors.gray700,
  },

  tableCellBold: {
    fontSize: fontSize.sm,
    fontFamily: "Helvetica-Bold",
    color: colors.gray900,
  },

  tableCellMuted: {
    fontSize: fontSize.xs,
    color: colors.gray400,
    fontFamily: "Courier",
  },

  itemBadge: {
    fontSize: 5,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: 2,
    marginTop: spacing.xs,
    alignSelf: "flex-start",
  },

  // Column definitions
  colNum: { width: "5%" },
  colDesc: { width: "35%" },
  colQty: { width: "10%", textAlign: "center" },
  colUnit: { width: "8%", textAlign: "center" },
  colPrice: { width: "14%", textAlign: "right" },
  colDisc: { width: "10%", textAlign: "right" },
  colVat: { width: "8%", textAlign: "right" },
  colTotal: { width: "15%", textAlign: "right" },

  // PO specific columns
  colPODesc: { width: "40%" },
  colPOQty: { width: "12%", textAlign: "center" },
  colPOUnit: { width: "10%", textAlign: "center" },
  colPOPrice: { width: "18%", textAlign: "right" },
  colPOTotal: { width: "15%", textAlign: "right" },

  // ═══════════════════════════════════════════
  // SUMMARY SECTION
  // ═══════════════════════════════════════════
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.xl,
    marginBottom: spacing.lg,
  },

  notesArea: {
    flex: 1,
    maxWidth: "50%",
  },

  notesLabel: {
    fontSize: fontSize.sm,
    fontFamily: "Helvetica-Bold",
    color: colors.gray700,
    marginBottom: spacing.sm,
  },

  notesText: {
    fontSize: fontSize.sm,
    color: colors.gray500,
    lineHeight: 1.5,
  },

  totalsArea: {
    width: "45%",
    backgroundColor: colors.gray50,
    borderRadius: borderRadius.md,
    overflow: "hidden",
  },

  totalsLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },

  totalsLineBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.gray200,
  },

  totalsLabel: {
    fontSize: fontSize.sm,
    color: colors.gray600,
  },

  totalsValue: {
    fontSize: fontSize.sm,
    color: colors.gray800,
  },

  totalsFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },

  totalsFinalLabel: {
    fontSize: fontSize.lg,
    fontFamily: "Helvetica-Bold",
    color: colors.gray900,
  },

  totalsFinalValue: {
    fontSize: fontSize.xl,
    fontFamily: "Helvetica-Bold",
    color: colors.gray900,
  },

  // ═══════════════════════════════════════════
  // PAYMENT / BANK SECTION
  // ═══════════════════════════════════════════
  paymentRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },

  paymentCard: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.gray50,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },

  paymentCardDanger: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.dangerLight,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },

  paymentCardSuccess: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.successLight,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },

  paymentLabel: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },

  paymentValue: {
    fontSize: fontSize.xl,
    fontFamily: "Helvetica-Bold",
    color: colors.gray900,
  },

  paymentValueDanger: {
    fontSize: fontSize.xl,
    fontFamily: "Helvetica-Bold",
    color: colors.danger,
  },

  paymentValueSuccess: {
    fontSize: fontSize.xl,
    fontFamily: "Helvetica-Bold",
    color: colors.success,
  },

  paymentSubtext: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    marginTop: spacing.xs,
  },

  // Bank Details
  bankSection: {
    padding: spacing.lg,
    backgroundColor: colors.gray50,
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },

  bankTitle: {
    fontSize: fontSize.md,
    fontFamily: "Helvetica-Bold",
    color: colors.gray800,
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray200,
  },

  bankColumns: {
    flexDirection: "row",
    gap: spacing.xxl,
  },

  bankColumn: {
    flex: 1,
  },

  bankSubtitle: {
    fontSize: fontSize.xs,
    fontFamily: "Helvetica-Bold",
    color: colors.gray500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },

  bankLine: {
    flexDirection: "row",
    marginBottom: spacing.xs,
  },

  bankLabel: {
    fontSize: fontSize.sm,
    color: colors.gray500,
    width: 70,
  },

  bankValue: {
    fontSize: fontSize.sm,
    fontFamily: "Helvetica-Bold",
    color: colors.gray800,
    flex: 1,
  },

  // ═══════════════════════════════════════════
  // TERMS SECTION
  // ═══════════════════════════════════════════
  termsSection: {
    padding: spacing.md,
    backgroundColor: colors.gray50,
    borderRadius: borderRadius.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.gray400,
    marginBottom: spacing.lg,
  },

  termsLabel: {
    fontSize: fontSize.sm,
    fontFamily: "Helvetica-Bold",
    color: colors.gray700,
    marginBottom: spacing.xs,
  },

  termsText: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    lineHeight: 1.5,
  },

  // ═══════════════════════════════════════════
  // FOOTER SECTION
  // ═══════════════════════════════════════════
  footer: {
    position: "absolute",
    bottom: 20,
    left: 24,
    right: 24,
    borderTopWidth: 1,
    borderTopColor: colors.gray200,
    paddingTop: spacing.md,
  },

  footerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  footerSection: {
    flex: 1,
  },

  footerCenter: {
    flex: 1,
    textAlign: "center",
  },

  footerRight: {
    flex: 1,
    textAlign: "right",
    alignItems: "flex-end",
  },

  footerTitle: {
    fontSize: fontSize.sm,
    fontFamily: "Helvetica-Bold",
    color: colors.gray700,
    marginBottom: spacing.xs,
  },

  footerText: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    lineHeight: 1.3,
  },

  pageNumber: {
    fontSize: fontSize.sm,
    fontFamily: "Helvetica-Bold",
    color: colors.gray600,
  },

  // Thank you
  thankYou: {
    textAlign: "center",
    marginBottom: spacing.lg,
    paddingVertical: spacing.md,
  },

  thankYouText: {
    fontSize: fontSize.md,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },

  thankYouSubtext: {
    fontSize: fontSize.sm,
    color: colors.gray500,
    marginTop: spacing.xs,
  },

  // ═══════════════════════════════════════════
  // QUOTE SPECIFIC
  // ═══════════════════════════════════════════
  validityBanner: {
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },

  validityText: {
    fontSize: fontSize.sm,
    fontFamily: "Helvetica-Bold",
    color: colors.primaryDark,
  },

  // Signature area for quotes
  signatureRow: {
    flexDirection: "row",
    gap: spacing.xxl,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },

  signatureBlock: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: colors.gray300,
    borderTopStyle: "dashed",
    paddingTop: spacing.md,
  },

  signatureLabel: {
    fontSize: fontSize.xs,
    color: colors.gray500,
    marginBottom: spacing.xs,
  },

  signatureLine: {
    fontSize: fontSize.sm,
    color: colors.gray700,
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

const formatStatus = (status) => {
  if (!status) return "Draft";
  return status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
};

const getStatusStyle = (status) => {
  const statusMap = {
    draft: { bg: colors.gray200, text: colors.gray600 },
    sent: { bg: colors.infoLight, text: colors.info },
    pending: { bg: colors.warningLight, text: colors.warning },
    approved: { bg: colors.successLight, text: colors.success },
    completed: { bg: colors.successLight, text: colors.success },
    accepted: { bg: colors.successLight, text: colors.success },
    rejected: { bg: colors.dangerLight, text: colors.danger },
    cancelled: { bg: colors.dangerLight, text: colors.danger },
    expired: { bg: colors.gray200, text: colors.gray600 },
    converted: { bg: colors.primaryLight, text: colors.primaryDark },
    partial: { bg: colors.infoLight, text: colors.info },
    received: { bg: colors.successLight, text: colors.success },
    confirmed: { bg: colors.successLight, text: colors.success },
  };
  return statusMap[status] || statusMap.draft;
};

const getPaymentStatusStyle = (status, isOverdue = false) => {
  if (isOverdue) return { bg: colors.dangerLight, text: colors.danger };
  const map = {
    unpaid: { bg: colors.warningLight, text: colors.warning },
    partial: { bg: colors.infoLight, text: colors.info },
    paid: { bg: colors.successLight, text: colors.success },
    overdue: { bg: colors.dangerLight, text: colors.danger },
  };
  return map[status] || map.unpaid;
};

// ============================================
// SHARED COMPONENTS
// ============================================

// Company default info
const defaultCompany = {
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

const defaultBankDetails = {
  bankName: "Kenya Commercial Bank",
  accountName: "QSL Technologies Ltd",
  accountNumber: "1234567890",
  branchName: "Westlands Branch",
  branchCode: "001",
  swiftCode: "KCOBLRBY",
  mpesaPaybill: "123456",
  mpesaAccountNumber: "Invoice Number",
};

// Document Header Component
const DocumentHeader = ({
  company,
  docType,
  docNumber,
  docDate,
  status,
  paymentStatus,
  isOverdue,
}) => {
  const companyInfo = { ...defaultCompany, ...company };
  const statusStyle = getStatusStyle(status);
  const paymentStyle = paymentStatus
    ? getPaymentStatusStyle(paymentStatus, isOverdue)
    : null;

  return (
    <View style={baseStyles.header}>
      <View style={baseStyles.logoArea}>
        <Image src="/qsl.png" style={baseStyles.logo} />
        <View style={baseStyles.companyBlock}>
          <Text style={baseStyles.companyName}>{companyInfo.name}</Text>
          {companyInfo.tagline && (
            <Text style={baseStyles.companyTagline}>{companyInfo.tagline}</Text>
          )}
          <Text style={baseStyles.companyContact}>
            {companyInfo.address}
            {"\n"}
            {companyInfo.city}
          </Text>
        </View>
      </View>

      <View style={baseStyles.titleArea}>
        <Text style={baseStyles.docType}>{docType}</Text>
        <Text style={baseStyles.docNumber}>{docNumber}</Text>
        <Text style={baseStyles.docMeta}>{formatDate(docDate)}</Text>

        <View style={baseStyles.badgeRow}>
          <View style={[baseStyles.badge, { backgroundColor: statusStyle.bg }]}>
            <Text style={[baseStyles.badgeText, { color: statusStyle.text }]}>
              {formatStatus(status)}
            </Text>
          </View>
          {paymentStyle && (
            <View
              style={[baseStyles.badge, { backgroundColor: paymentStyle.bg }]}
            >
              <Text
                style={[baseStyles.badgeText, { color: paymentStyle.text }]}
              >
                {isOverdue ? "OVERDUE" : formatStatus(paymentStatus)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

// Document Footer Component
const DocumentFooter = ({ company }) => {
  const companyInfo = { ...defaultCompany, ...company };

  return (
    <View style={baseStyles.footer} fixed>
      <View style={baseStyles.footerContent}>
        <View style={baseStyles.footerSection}>
          <Text style={baseStyles.footerTitle}>{companyInfo.name}</Text>
          <Text style={baseStyles.footerText}>
            {companyInfo.address}, {companyInfo.city}
            {companyInfo.postalCode && `\n${companyInfo.postalCode}`}
          </Text>
        </View>

        <View style={baseStyles.footerCenter}>
          <Text style={baseStyles.footerText}>Tel: {companyInfo.phone}</Text>
          <Text style={baseStyles.footerText}>{companyInfo.email}</Text>
          {companyInfo.website && (
            <Text style={baseStyles.footerText}>{companyInfo.website}</Text>
          )}
        </View>

        <View style={baseStyles.footerRight}>
          <Text style={baseStyles.footerText}>PIN: {companyInfo.pin}</Text>
          <Text
            style={baseStyles.pageNumber}
            render={({ pageNumber, totalPages }) =>
              totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : ""
            }
          />
        </View>
      </View>
    </View>
  );
};

// Bank Details Component
const BankDetails = ({ bankDetails, reference }) => {
  const bankInfo = { ...defaultBankDetails, ...bankDetails };

  return (
    <View style={baseStyles.bankSection}>
      <Text style={baseStyles.bankTitle}>Payment Details</Text>
      <View style={baseStyles.bankColumns}>
        <View style={baseStyles.bankColumn}>
          <Text style={baseStyles.bankSubtitle}>Bank Transfer</Text>
          <View style={baseStyles.bankLine}>
            <Text style={baseStyles.bankLabel}>Bank:</Text>
            <Text style={baseStyles.bankValue}>{bankInfo.bankName}</Text>
          </View>
          <View style={baseStyles.bankLine}>
            <Text style={baseStyles.bankLabel}>Account:</Text>
            <Text style={baseStyles.bankValue}>{bankInfo.accountName}</Text>
          </View>
          <View style={baseStyles.bankLine}>
            <Text style={baseStyles.bankLabel}>Account No:</Text>
            <Text style={baseStyles.bankValue}>{bankInfo.accountNumber}</Text>
          </View>
          <View style={baseStyles.bankLine}>
            <Text style={baseStyles.bankLabel}>Branch:</Text>
            <Text style={baseStyles.bankValue}>{bankInfo.branchName}</Text>
          </View>
          <View style={baseStyles.bankLine}>
            <Text style={baseStyles.bankLabel}>Swift:</Text>
            <Text style={baseStyles.bankValue}>{bankInfo.swiftCode}</Text>
          </View>
        </View>

        <View style={baseStyles.bankColumn}>
          <Text style={baseStyles.bankSubtitle}>M-Pesa</Text>
          <View style={baseStyles.bankLine}>
            <Text style={baseStyles.bankLabel}>Paybill:</Text>
            <Text style={baseStyles.bankValue}>{bankInfo.mpesaPaybill}</Text>
          </View>
          <View style={baseStyles.bankLine}>
            <Text style={baseStyles.bankLabel}>Account:</Text>
            <Text style={baseStyles.bankValue}>{reference}</Text>
          </View>
          <View style={{ marginTop: spacing.md }}>
            <Text
              style={[
                baseStyles.bankLabel,
                { fontStyle: "italic", width: "auto" },
              ]}
            >
              Reference: {reference}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                              INVOICE PDF                                      ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
export const InvoicePDFTemp = ({ data, company, bankDetails }) => {
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
    paymentStatus = "unpaid",
    amountPaid = 0,
    amountDue = 0,
    status = "draft",
    paymentTerms = "Net 30",
    purchaseOrderNumber,
    quoteRef,
    notes,
    termsAndConditions,
  } = data || {};

  const hasItems = items && items.length > 0;
  const hasDiscount = totalDiscount > 0;
  const isOverdue =
    paymentStatus !== "paid" &&
    status === "completed" &&
    dueDate &&
    new Date() > new Date(dueDate);
  const showPaymentInfo = status === "completed" && paymentStatus !== "paid";

  return (
    <Document>
      <Page size="A4" style={baseStyles.page}>
        {/* HEADER */}
        <DocumentHeader
          company={company}
          docType="INVOICE"
          docNumber={invoiceNumber}
          docDate={invoiceDate}
          status={status}
          paymentStatus={status === "completed" ? paymentStatus : null}
          isOverdue={isOverdue}
        />

        {/* INFO CARDS */}
        <View style={baseStyles.infoRow}>
          {/* Bill To */}
          <View style={baseStyles.infoCard}>
            <Text style={baseStyles.infoLabel}>Bill To</Text>
            <Text style={baseStyles.infoTitle}>{customer.name || "-"}</Text>
            {customer.address && (
              <Text style={baseStyles.infoText}>{customer.address}</Text>
            )}
            {customer.taxPin && (
              <Text style={baseStyles.infoText}>PIN: {customer.taxPin}</Text>
            )}
            {customer.phone && (
              <Text style={baseStyles.infoText}>Tel: {customer.phone}</Text>
            )}
            {customer.email && (
              <Text style={baseStyles.infoText}>{customer.email}</Text>
            )}
          </View>

          {/* Ship To */}
          <View style={baseStyles.infoCard}>
            <Text style={baseStyles.infoLabel}>Ship To</Text>
            <Text style={baseStyles.infoTitle}>{customer.name || "-"}</Text>
            {customer.address && (
              <Text style={baseStyles.infoText}>
                {customer.address?.country}
              </Text>
            )}
            {customer.phone && (
              <Text style={baseStyles.infoText}>Tel: {customer.phone}</Text>
            )}
          </View>

          {/* Invoice Details */}
          <View style={baseStyles.infoCardAccent}>
            <View style={baseStyles.infoLine}>
              <Text style={baseStyles.infoLineLabel}>Invoice Date:</Text>
              <Text style={baseStyles.infoLineValue}>
                {formatDate(invoiceDate)}
              </Text>
            </View>
            <View style={baseStyles.infoLine}>
              <Text style={baseStyles.infoLineLabel}>Due Date:</Text>
              <Text
                style={[
                  baseStyles.infoLineValue,
                  isOverdue && { color: colors.danger },
                ]}
              >
                {formatDate(dueDate)}
              </Text>
            </View>
            <View style={baseStyles.infoLine}>
              <Text style={baseStyles.infoLineLabel}>Terms:</Text>
              <Text style={baseStyles.infoLineValue}>{paymentTerms}</Text>
            </View>
            {purchaseOrderNumber && (
              <View style={baseStyles.infoLine}>
                <Text style={baseStyles.infoLineLabel}>PO Number:</Text>
                <Text style={baseStyles.infoLineValue}>
                  {purchaseOrderNumber}
                </Text>
              </View>
            )}
            {quoteRef?.quoteNumber && (
              <View style={baseStyles.infoLine}>
                <Text style={baseStyles.infoLineLabel}>Quote Ref:</Text>
                <Text style={baseStyles.infoLineValue}>
                  {quoteRef.quoteNumber}
                </Text>
              </View>
            )}
            <View style={baseStyles.infoLine}>
              <Text style={baseStyles.infoLineLabel}>Currency:</Text>
              <Text style={baseStyles.infoLineValue}>{currency}</Text>
            </View>
          </View>
        </View>

        {/* ITEMS TABLE */}
        <View style={baseStyles.table}>
          <View style={baseStyles.tableHeader} fixed>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colNum]}>
              #
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colDesc]}>
              Description
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colQty]}>
              Qty
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colUnit]}>
              Unit
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colPrice]}>
              Unit Price
            </Text>
            {hasDiscount && (
              <Text style={[baseStyles.tableHeaderCell, baseStyles.colDisc]}>
                Disc
              </Text>
            )}
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colVat]}>
              VAT
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colTotal]}>
              Amount
            </Text>
          </View>

          {hasItems ? (
            items.map((item, index) => {
              const isProduct = item.itemType === "product";
              return (
                <View
                  key={item._id || index}
                  style={[
                    baseStyles.tableRow,
                    index % 2 === 1 && baseStyles.tableRowAlt,
                  ]}
                  wrap={false}
                >
                  <Text style={[baseStyles.tableCellMuted, baseStyles.colNum]}>
                    {index + 1}
                  </Text>
                  <View style={baseStyles.colDesc}>
                    <Text style={baseStyles.tableCell}>
                      {item.description || item.productName}
                    </Text>
                    {isProduct && item.productSKU && (
                      <Text style={baseStyles.tableCellMuted}>
                        SKU: {item.productSKU}
                      </Text>
                    )}
                    <View
                      style={[
                        baseStyles.itemBadge,
                        {
                          backgroundColor: isProduct
                            ? colors.infoLight
                            : colors.successLight,
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
                  <Text style={[baseStyles.tableCell, baseStyles.colQty]}>
                    {item.quantity || 0}
                  </Text>
                  <Text style={[baseStyles.tableCellMuted, baseStyles.colUnit]}>
                    {item.unit || "pcs"}
                  </Text>
                  <Text style={[baseStyles.tableCell, baseStyles.colPrice]}>
                    {formatCurrency(item.unitPrice, currency)}
                  </Text>
                  {hasDiscount && (
                    <Text
                      style={[
                        baseStyles.tableCell,
                        baseStyles.colDisc,
                        item.discountAmount > 0 && { color: colors.danger },
                      ]}
                    >
                      {item.discountAmount > 0
                        ? `(${formatCurrency(item.discountAmount, currency)})`
                        : "-"}
                    </Text>
                  )}
                  <Text style={[baseStyles.tableCellMuted, baseStyles.colVat]}>
                    {item.taxRate ?? 16}%
                  </Text>
                  <Text style={[baseStyles.tableCellBold, baseStyles.colTotal]}>
                    {formatCurrency(item.amount, currency)}
                  </Text>
                </View>
              );
            })
          ) : (
            <View style={baseStyles.tableRow}>
              <Text
                style={{
                  width: "100%",
                  textAlign: "center",
                  color: colors.gray400,
                  fontStyle: "italic",
                }}
              >
                No items on this invoice
              </Text>
            </View>
          )}
        </View>

        {/* SUMMARY */}
        <View style={baseStyles.summaryRow} wrap={false}>
          <View style={baseStyles.notesArea}>
            <Text style={baseStyles.notesLabel}>
              {notes ? "Notes" : "Payment Instructions"}
            </Text>
            <Text style={baseStyles.notesText}>
              {notes ||
                `Please reference invoice number ${invoiceNumber} on all payments. Payment is due by ${formatDate(dueDate)}.`}
            </Text>
          </View>

          <View style={baseStyles.totalsArea}>
            <View style={baseStyles.totalsLine}>
              <Text style={baseStyles.totalsLabel}>Subtotal:</Text>
              <Text style={baseStyles.totalsValue}>
                {formatCurrency(subtotal, currency)}
              </Text>
            </View>
            {hasDiscount && (
              <View
                style={[baseStyles.totalsLine, baseStyles.totalsLineBorder]}
              >
                <Text style={baseStyles.totalsLabel}>Discount:</Text>
                <Text
                  style={[baseStyles.totalsValue, { color: colors.danger }]}
                >
                  ({formatCurrency(totalDiscount, currency)})
                </Text>
              </View>
            )}
            <View style={[baseStyles.totalsLine, baseStyles.totalsLineBorder]}>
              <Text style={baseStyles.totalsLabel}>VAT (16%):</Text>
              <Text style={baseStyles.totalsValue}>
                {formatCurrency(taxAmount, currency)}
              </Text>
            </View>
            <View style={baseStyles.totalsFinal}>
              <Text style={baseStyles.totalsFinalLabel}>Total:</Text>
              <Text style={baseStyles.totalsFinalValue}>
                {formatCurrency(total, currency)}
              </Text>
            </View>
            {amountPaid > 0 && (
              <>
                <View
                  style={[
                    baseStyles.totalsLine,
                    { backgroundColor: colors.white },
                  ]}
                >
                  <Text style={baseStyles.totalsLabel}>Paid:</Text>
                  <Text
                    style={[baseStyles.totalsValue, { color: colors.success }]}
                  >
                    ({formatCurrency(amountPaid, currency)})
                  </Text>
                </View>
                <View
                  style={[
                    baseStyles.totalsLine,
                    {
                      backgroundColor: isOverdue
                        ? colors.dangerLight
                        : colors.warningLight,
                    },
                  ]}
                >
                  <Text
                    style={[
                      baseStyles.totalsLabel,
                      { fontFamily: "Helvetica-Bold" },
                    ]}
                  >
                    Due:
                  </Text>
                  <Text
                    style={[
                      baseStyles.totalsValue,
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

        {/* PAYMENT STATUS */}
        {status === "completed" && (
          <View style={baseStyles.paymentRow} wrap={false}>
            <View
              style={
                paymentStatus === "paid"
                  ? baseStyles.paymentCardSuccess
                  : isOverdue
                    ? baseStyles.paymentCardDanger
                    : baseStyles.paymentCard
              }
            >
              <Text style={baseStyles.paymentLabel}>Amount Due</Text>
              <Text
                style={
                  paymentStatus === "paid"
                    ? baseStyles.paymentValueSuccess
                    : isOverdue
                      ? baseStyles.paymentValueDanger
                      : baseStyles.paymentValue
                }
              >
                {paymentStatus === "paid"
                  ? "PAID IN FULL"
                  : formatCurrency(amountDue, currency)}
              </Text>
              {paymentStatus !== "paid" && (
                <Text style={baseStyles.paymentSubtext}>
                  Due: {formatDate(dueDate)}
                  {isOverdue && " (OVERDUE)"}
                </Text>
              )}
            </View>

            <View style={baseStyles.paymentCard}>
              <Text style={baseStyles.paymentLabel}>Payment Method</Text>
              <Text style={baseStyles.paymentValue}>Bank / M-Pesa</Text>
              <Text style={baseStyles.paymentSubtext}>See details below</Text>
            </View>
          </View>
        )}

        {/* BANK DETAILS */}
        {showPaymentInfo && (
          <BankDetails bankDetails={bankDetails} reference={invoiceNumber} />
        )}

        {/* TERMS */}
        {termsAndConditions && (
          <View style={baseStyles.termsSection} wrap={false}>
            <Text style={baseStyles.termsLabel}>Terms & Conditions</Text>
            <Text style={baseStyles.termsText}>{termsAndConditions}</Text>
          </View>
        )}

        {/* THANK YOU */}
        <View style={baseStyles.thankYou} wrap={false}>
          <Text style={baseStyles.thankYouText}>
            Thank you for your business!
          </Text>
          <Text style={baseStyles.thankYouSubtext}>
            Questions? Contact us at {company?.email || defaultCompany.email}
          </Text>
        </View>

        {/* FOOTER */}
        <DocumentFooter company={company} />
      </Page>
    </Document>
  );
};

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                          PURCHASE ORDER PDF                                   ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
export const PurchaseOrderPDF = ({ data, company }) => {
  const {
    poNumber = "PO-DRAFT",
    poDate,
    expectedDeliveryDate,
    supplier = {},
    items = [],
    subtotal = 0,
    taxAmount = 0,
    total = 0,
    currency = "KES",
    status = "draft",
    deliveryAddress,
    notes,
    termsAndConditions,
  } = data || {};

  const hasItems = items && items.length > 0;
  const companyInfo = { ...defaultCompany, ...company };

  return (
    <Document>
      <Page size="A4" style={baseStyles.page}>
        {/* HEADER */}
        <DocumentHeader
          company={company}
          docType="PURCHASE ORDER"
          docNumber={poNumber}
          docDate={poDate}
          status={status}
        />

        {/* INFO CARDS */}
        <View style={baseStyles.infoRow}>
          {/* Supplier */}
          <View style={baseStyles.infoCard}>
            <Text style={baseStyles.infoLabel}>Supplier</Text>
            <Text style={baseStyles.infoTitle}>{supplier.name || "-"}</Text>
            {supplier.address && (
              <Text style={baseStyles.infoText}>{supplier.address}</Text>
            )}
            {supplier.taxPin && (
              <Text style={baseStyles.infoText}>PIN: {supplier.taxPin}</Text>
            )}
            {supplier.phone && (
              <Text style={baseStyles.infoText}>Tel: {supplier.phone}</Text>
            )}
            {supplier.email && (
              <Text style={baseStyles.infoText}>{supplier.email}</Text>
            )}
          </View>

          {/* Delivery Address */}
          <View style={baseStyles.infoCard}>
            <Text style={baseStyles.infoLabel}>Deliver To</Text>
            <Text style={baseStyles.infoTitle}>{companyInfo.name}</Text>
            <Text style={baseStyles.infoText}>
              {deliveryAddress || `${companyInfo.address}, ${companyInfo.city}`}
            </Text>
            <Text style={baseStyles.infoText}>Tel: {companyInfo.phone}</Text>
          </View>

          {/* PO Details */}
          <View style={baseStyles.infoCardAccent}>
            <View style={baseStyles.infoLine}>
              <Text style={baseStyles.infoLineLabel}>PO Date:</Text>
              <Text style={baseStyles.infoLineValue}>{formatDate(poDate)}</Text>
            </View>
            <View style={baseStyles.infoLine}>
              <Text style={baseStyles.infoLineLabel}>Delivery By:</Text>
              <Text style={baseStyles.infoLineValue}>
                {formatDate(expectedDeliveryDate)}
              </Text>
            </View>
            <View style={baseStyles.infoLine}>
              <Text style={baseStyles.infoLineLabel}>Currency:</Text>
              <Text style={baseStyles.infoLineValue}>{currency}</Text>
            </View>
          </View>
        </View>

        {/* ITEMS TABLE */}
        <View style={baseStyles.table}>
          <View style={baseStyles.tableHeader} fixed>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colNum]}>
              #
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colPODesc]}>
              Description
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colPOQty]}>
              Qty
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colPOUnit]}>
              Unit
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colPOPrice]}>
              Unit Price
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colPOTotal]}>
              Amount
            </Text>
          </View>

          {hasItems ? (
            items.map((item, index) => (
              <View
                key={item._id || index}
                style={[
                  baseStyles.tableRow,
                  index % 2 === 1 && baseStyles.tableRowAlt,
                ]}
                wrap={false}
              >
                <Text style={[baseStyles.tableCellMuted, baseStyles.colNum]}>
                  {index + 1}
                </Text>
                <View style={baseStyles.colPODesc}>
                  <Text style={baseStyles.tableCell}>
                    {item.description || item.productName}
                  </Text>
                  {item.productSKU && (
                    <Text style={baseStyles.tableCellMuted}>
                      SKU: {item.productSKU}
                    </Text>
                  )}
                </View>
                <Text style={[baseStyles.tableCell, baseStyles.colPOQty]}>
                  {item.quantity || 0}
                </Text>
                <Text style={[baseStyles.tableCellMuted, baseStyles.colPOUnit]}>
                  {item.unit || "pcs"}
                </Text>
                <Text style={[baseStyles.tableCell, baseStyles.colPOPrice]}>
                  {formatCurrency(item.unitPrice, currency)}
                </Text>
                <Text style={[baseStyles.tableCellBold, baseStyles.colPOTotal]}>
                  {formatCurrency(
                    item.amount || item.quantity * item.unitPrice,
                    currency,
                  )}
                </Text>
              </View>
            ))
          ) : (
            <View style={baseStyles.tableRow}>
              <Text
                style={{
                  width: "100%",
                  textAlign: "center",
                  color: colors.gray400,
                  fontStyle: "italic",
                }}
              >
                No items on this purchase order
              </Text>
            </View>
          )}
        </View>

        {/* SUMMARY */}
        <View style={baseStyles.summaryRow} wrap={false}>
          <View style={baseStyles.notesArea}>
            {notes && (
              <>
                <Text style={baseStyles.notesLabel}>Notes</Text>
                <Text style={baseStyles.notesText}>{notes}</Text>
              </>
            )}
            {!notes && (
              <>
                <Text style={baseStyles.notesLabel}>Delivery Instructions</Text>
                <Text style={baseStyles.notesText}>
                  Please deliver goods to the address above by{" "}
                  {formatDate(expectedDeliveryDate)}. Include PO number{" "}
                  {poNumber} on all correspondence and delivery documents.
                </Text>
              </>
            )}
          </View>

          <View style={baseStyles.totalsArea}>
            <View style={baseStyles.totalsLine}>
              <Text style={baseStyles.totalsLabel}>Subtotal:</Text>
              <Text style={baseStyles.totalsValue}>
                {formatCurrency(subtotal, currency)}
              </Text>
            </View>
            <View style={[baseStyles.totalsLine, baseStyles.totalsLineBorder]}>
              <Text style={baseStyles.totalsLabel}>VAT (16%):</Text>
              <Text style={baseStyles.totalsValue}>
                {formatCurrency(taxAmount, currency)}
              </Text>
            </View>
            <View style={baseStyles.totalsFinal}>
              <Text style={baseStyles.totalsFinalLabel}>Total:</Text>
              <Text style={baseStyles.totalsFinalValue}>
                {formatCurrency(total, currency)}
              </Text>
            </View>
          </View>
        </View>

        {/* TERMS */}
        {termsAndConditions && (
          <View style={baseStyles.termsSection} wrap={false}>
            <Text style={baseStyles.termsLabel}>Terms & Conditions</Text>
            <Text style={baseStyles.termsText}>{termsAndConditions}</Text>
          </View>
        )}

        {/* AUTHORIZATION */}
        <View style={baseStyles.signatureRow} wrap={false}>
          <View style={baseStyles.signatureBlock}>
            <Text style={baseStyles.signatureLabel}>Authorized By:</Text>
            <Text style={baseStyles.signatureLine}>
              ________________________
            </Text>
            <Text
              style={[baseStyles.signatureLabel, { marginTop: spacing.sm }]}
            >
              Name & Signature
            </Text>
          </View>
          <View style={baseStyles.signatureBlock}>
            <Text style={baseStyles.signatureLabel}>Date:</Text>
            <Text style={baseStyles.signatureLine}>
              ________________________
            </Text>
          </View>
        </View>

        {/* FOOTER */}
        <DocumentFooter company={company} />
      </Page>
    </Document>
  );
};

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                              QUOTE PDF                                        ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
export const QuotePDF = ({ data, company }) => {
  const {
    quoteNumber = "QT-DRAFT",
    quoteDate,
    validUntil,
    customer = {},
    salesPerson = {},
    items = [],
    subtotal = 0,
    totalDiscount = 0,
    taxAmount = 0,
    total = 0,
    currency = "KES",
    status = "draft",
    notes,
    termsAndConditions,
  } = data || {};

  const hasItems = items && items.length > 0;
  const hasDiscount = totalDiscount > 0;
  const isExpired =
    validUntil &&
    new Date() > new Date(validUntil) &&
    status !== "accepted" &&
    status !== "converted";
  const companyInfo = { ...defaultCompany, ...company };

  // Calculate days until expiry
  const daysUntilExpiry = validUntil
    ? Math.ceil((new Date(validUntil) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <Document>
      <Page size="A4" style={baseStyles.page}>
        {/* HEADER */}
        <DocumentHeader
          company={company}
          docType="QUOTATION"
          docNumber={quoteNumber}
          docDate={quoteDate}
          status={isExpired ? "expired" : status}
        />

        {/* VALIDITY BANNER */}
        {validUntil && !isExpired && status === "sent" && (
          <View style={baseStyles.validityBanner}>
            <Text style={baseStyles.validityText}>
              ⏰ This quote is valid until {formatDate(validUntil)}
              {daysUntilExpiry !== null &&
                daysUntilExpiry > 0 &&
                ` (${daysUntilExpiry} days remaining)`}
            </Text>
          </View>
        )}

        {isExpired && (
          <View
            style={[
              baseStyles.validityBanner,
              {
                backgroundColor: colors.dangerLight,
                borderColor: colors.danger,
              },
            ]}
          >
            <Text style={[baseStyles.validityText, { color: colors.danger }]}>
              ⚠ This quote expired on {formatDate(validUntil)}
            </Text>
          </View>
        )}

        {/* INFO CARDS */}
        <View style={baseStyles.infoRow}>
          {/* Customer */}
          <View style={baseStyles.infoCard}>
            <Text style={baseStyles.infoLabel}>Prepared For</Text>
            <Text style={baseStyles.infoTitle}>{customer.name || "-"}</Text>
            {customer.address && (
              <Text style={baseStyles.infoText}>{customer.address}</Text>
            )}
            {customer.taxPin && (
              <Text style={baseStyles.infoText}>PIN: {customer.taxPin}</Text>
            )}
            {customer.phone && (
              <Text style={baseStyles.infoText}>Tel: {customer.phone}</Text>
            )}
            {customer.email && (
              <Text style={baseStyles.infoText}>{customer.email}</Text>
            )}
          </View>

          {/* Sales Contact */}
          <View style={baseStyles.infoCard}>
            <Text style={baseStyles.infoLabel}>Your Contact</Text>
            <Text style={baseStyles.infoTitle}>
              {salesPerson.name || companyInfo.name}
            </Text>
            <Text style={baseStyles.infoText}>{companyInfo.phone}</Text>
            <Text style={baseStyles.infoText}>{companyInfo.email}</Text>
          </View>

          {/* Quote Details */}
          <View style={baseStyles.infoCardAccent}>
            <View style={baseStyles.infoLine}>
              <Text style={baseStyles.infoLineLabel}>Quote Date:</Text>
              <Text style={baseStyles.infoLineValue}>
                {formatDate(quoteDate)}
              </Text>
            </View>
            <View style={baseStyles.infoLine}>
              <Text style={baseStyles.infoLineLabel}>Valid Until:</Text>
              <Text
                style={[
                  baseStyles.infoLineValue,
                  isExpired && { color: colors.danger },
                ]}
              >
                {formatDate(validUntil)}
              </Text>
            </View>
            <View style={baseStyles.infoLine}>
              <Text style={baseStyles.infoLineLabel}>Currency:</Text>
              <Text style={baseStyles.infoLineValue}>{currency}</Text>
            </View>
          </View>
        </View>

        {/* ITEMS TABLE */}
        <View style={baseStyles.table}>
          <View style={baseStyles.tableHeader} fixed>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colNum]}>
              #
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colDesc]}>
              Description
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colQty]}>
              Qty
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colUnit]}>
              Unit
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colPrice]}>
              Unit Price
            </Text>
            {hasDiscount && (
              <Text style={[baseStyles.tableHeaderCell, baseStyles.colDisc]}>
                Disc
              </Text>
            )}
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colVat]}>
              VAT
            </Text>
            <Text style={[baseStyles.tableHeaderCell, baseStyles.colTotal]}>
              Amount
            </Text>
          </View>

          {hasItems ? (
            items.map((item, index) => {
              const isProduct = item.itemType === "product";
              return (
                <View
                  key={item._id || index}
                  style={[
                    baseStyles.tableRow,
                    index % 2 === 1 && baseStyles.tableRowAlt,
                  ]}
                  wrap={false}
                >
                  <Text style={[baseStyles.tableCellMuted, baseStyles.colNum]}>
                    {index + 1}
                  </Text>
                  <View style={baseStyles.colDesc}>
                    <Text style={baseStyles.tableCell}>
                      {item.description || item.productName}
                    </Text>
                    {isProduct && item.productSKU && (
                      <Text style={baseStyles.tableCellMuted}>
                        SKU: {item.productSKU}
                      </Text>
                    )}
                    <View
                      style={[
                        baseStyles.itemBadge,
                        {
                          backgroundColor: isProduct
                            ? colors.infoLight
                            : colors.successLight,
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
                  <Text style={[baseStyles.tableCell, baseStyles.colQty]}>
                    {item.quantity || 0}
                  </Text>
                  <Text style={[baseStyles.tableCellMuted, baseStyles.colUnit]}>
                    {item.unit || "pcs"}
                  </Text>
                  <Text style={[baseStyles.tableCell, baseStyles.colPrice]}>
                    {formatCurrency(item.unitPrice, currency)}
                  </Text>
                  {hasDiscount && (
                    <Text
                      style={[
                        baseStyles.tableCell,
                        baseStyles.colDisc,
                        item.discountAmount > 0 && { color: colors.danger },
                      ]}
                    >
                      {item.discountAmount > 0
                        ? `(${formatCurrency(item.discountAmount, currency)})`
                        : "-"}
                    </Text>
                  )}
                  <Text style={[baseStyles.tableCellMuted, baseStyles.colVat]}>
                    {item.taxRate ?? 16}%
                  </Text>
                  <Text style={[baseStyles.tableCellBold, baseStyles.colTotal]}>
                    {formatCurrency(item.amount, currency)}
                  </Text>
                </View>
              );
            })
          ) : (
            <View style={baseStyles.tableRow}>
              <Text
                style={{
                  width: "100%",
                  textAlign: "center",
                  color: colors.gray400,
                  fontStyle: "italic",
                }}
              >
                No items on this quote
              </Text>
            </View>
          )}
        </View>

        {/* SUMMARY */}
        <View style={baseStyles.summaryRow} wrap={false}>
          <View style={baseStyles.notesArea}>
            {notes && (
              <>
                <Text style={baseStyles.notesLabel}>Notes</Text>
                <Text style={baseStyles.notesText}>{notes}</Text>
              </>
            )}
            {!notes && (
              <>
                <Text style={baseStyles.notesLabel}>Next Steps</Text>
                <Text style={baseStyles.notesText}>
                  To proceed with this quote, please contact us at{" "}
                  {companyInfo.email} or {companyInfo.phone}. Upon acceptance,
                  we will generate an invoice for your records.
                </Text>
              </>
            )}
          </View>

          <View style={baseStyles.totalsArea}>
            <View style={baseStyles.totalsLine}>
              <Text style={baseStyles.totalsLabel}>Subtotal:</Text>
              <Text style={baseStyles.totalsValue}>
                {formatCurrency(subtotal, currency)}
              </Text>
            </View>
            {hasDiscount && (
              <View
                style={[baseStyles.totalsLine, baseStyles.totalsLineBorder]}
              >
                <Text style={baseStyles.totalsLabel}>Discount:</Text>
                <Text
                  style={[baseStyles.totalsValue, { color: colors.danger }]}
                >
                  ({formatCurrency(totalDiscount, currency)})
                </Text>
              </View>
            )}
            <View style={[baseStyles.totalsLine, baseStyles.totalsLineBorder]}>
              <Text style={baseStyles.totalsLabel}>VAT (16%):</Text>
              <Text style={baseStyles.totalsValue}>
                {formatCurrency(taxAmount, currency)}
              </Text>
            </View>
            <View style={baseStyles.totalsFinal}>
              <Text style={baseStyles.totalsFinalLabel}>Total:</Text>
              <Text style={baseStyles.totalsFinalValue}>
                {formatCurrency(total, currency)}
              </Text>
            </View>
          </View>
        </View>

        {/* TERMS */}
        {termsAndConditions && (
          <View style={baseStyles.termsSection} wrap={false}>
            <Text style={baseStyles.termsLabel}>Terms & Conditions</Text>
            <Text style={baseStyles.termsText}>{termsAndConditions}</Text>
          </View>
        )}

        {/* ACCEPTANCE SECTION */}
        <View
          style={[baseStyles.bankSection, { marginTop: spacing.lg }]}
          wrap={false}
        >
          <Text style={baseStyles.bankTitle}>Acceptance</Text>
          <Text style={[baseStyles.notesText, { marginBottom: spacing.lg }]}>
            By signing below, I accept the terms and conditions of this
            quotation and authorize {companyInfo.name} to proceed.
          </Text>

          <View style={baseStyles.signatureRow}>
            <View style={baseStyles.signatureBlock}>
              <Text style={baseStyles.signatureLabel}>Customer Signature:</Text>
              <Text style={baseStyles.signatureLine}>
                ________________________
              </Text>
              <Text
                style={[baseStyles.signatureLabel, { marginTop: spacing.sm }]}
              >
                Name & Title
              </Text>
            </View>
            <View style={baseStyles.signatureBlock}>
              <Text style={baseStyles.signatureLabel}>Date:</Text>
              <Text style={baseStyles.signatureLine}>
                ________________________
              </Text>
            </View>
          </View>
        </View>

        {/* THANK YOU */}
        <View style={baseStyles.thankYou} wrap={false}>
          <Text style={baseStyles.thankYouText}>
            Thank you for considering {companyInfo.name}!
          </Text>
          <Text style={baseStyles.thankYouSubtext}>
            We look forward to working with you
          </Text>
        </View>

        {/* FOOTER */}
        <DocumentFooter company={company} />
      </Page>
    </Document>
  );
};

// ============================================
// EXPORTS
// ============================================
export default {
  InvoicePDFTemp,
  PurchaseOrderPDF,
  QuotePDF,
};

import { StyleSheet } from "@react-pdf/renderer";

// Brand colors - clean professional palette
export const colors = {
  primary: "#1e293b",      // Slate 800 - main text
  secondary: "#475569",    // Slate 600 - secondary text
  accent: "#f59e0b",       // Amber 500 - Qalibrated gold
  accentLight: "#fef3c7",  // Amber 100 - light accent bg
  muted: "#64748b",        // Slate 500
  light: "#94a3b8",        // Slate 400
  border: "#e2e8f0",       // Slate 200
  borderLight: "#f1f5f9",  // Slate 100
  background: "#f8fafc",   // Slate 50
  white: "#ffffff",
  success: "#059669",      // Emerald 600
  successLight: "#d1fae5", // Emerald 100
  danger: "#dc2626",       // Red 600
  dangerLight: "#fee2e2",  // Red 100
  warning: "#d97706",      // Amber 600
  warningLight: "#fef3c7", // Amber 100
  info: "#0284c7",         // Sky 600
  infoLight: "#e0f2fe",    // Sky 100
};

// Professional styles inspired by modern ERP systems
export const styles = StyleSheet.create({
  // Page Layout
  page: {
    padding: 48,
    paddingBottom: 70,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: colors.primary,
    backgroundColor: colors.white,
  },

  // =====================
  // HEADER SECTION
  // =====================
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 32,
  },
  logoContainer: {
    flexDirection: "column",
    maxWidth: 200,
  },
  logo: {
    height: 44,
    marginBottom: 6,
  },
  companyInfo: {
    textAlign: "right",
    maxWidth: 200,
  },
  companyName: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    marginBottom: 6,
  },
  companyDetail: {
    fontSize: 8,
    color: colors.muted,
    marginBottom: 2,
    lineHeight: 1.4,
  },

  // =====================
  // DOCUMENT TITLE SECTION
  // =====================
  documentTitle: {
    marginBottom: 24,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  titleLeft: {
    flexDirection: "column",
  },
  titleText: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  documentNumber: {
    fontSize: 11,
    color: colors.muted,
  },
  titleDivider: {
    height: 3,
    backgroundColor: colors.accent,
    marginTop: 12,
    borderRadius: 2,
  },

  // =====================
  // STATUS BADGES
  // =====================
  statusBadge: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 4,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statusPaid: {
    backgroundColor: colors.successLight,
    color: colors.success,
  },
  statusUnpaid: {
    backgroundColor: colors.warningLight,
    color: colors.warning,
  },
  statusDraft: {
    backgroundColor: colors.borderLight,
    color: colors.muted,
  },
  statusOverdue: {
    backgroundColor: colors.dangerLight,
    color: colors.danger,
  },

  // =====================
  // INFO CARDS SECTION
  // =====================
  infoSection: {
    flexDirection: "row",
    marginBottom: 24,
    gap: 16,
  },
  infoCard: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 6,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoCardAccent: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: 6,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.accent,
    borderLeftWidth: 4,
  },
  infoCardLabel: {
    fontSize: 8,
    color: colors.light,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontFamily: "Helvetica-Bold",
  },
  infoCardTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    marginBottom: 4,
  },
  infoCardText: {
    fontSize: 9,
    color: colors.secondary,
    marginBottom: 2,
    lineHeight: 1.5,
  },

  // =====================
  // DETAILS ROW (Dates, Terms)
  // =====================
  detailsRow: {
    flexDirection: "row",
    backgroundColor: colors.background,
    borderRadius: 6,
    padding: 12,
    marginBottom: 24,
    gap: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailItem: {
    flexDirection: "column",
  },
  detailLabel: {
    fontSize: 7,
    color: colors.light,
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  detailValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },

  // =====================
  // LINE ITEMS TABLE
  // =====================
  table: {
    marginBottom: 24,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  tableHeaderCell: {
    color: colors.white,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tableBody: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.border,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  tableRowAlt: {
    backgroundColor: colors.background,
  },
  tableCell: {
    fontSize: 9,
    color: colors.secondary,
  },
  tableCellBold: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
  tableCellMuted: {
    fontSize: 8,
    color: colors.muted,
    marginTop: 2,
  },

  // Column widths for items table
  colNum: { width: "6%", textAlign: "center" },
  colDescription: { width: "38%" },
  colQuantity: { width: "12%", textAlign: "center" },
  colUnit: { width: "10%", textAlign: "center" },
  colUnitPrice: { width: "14%", textAlign: "right" },
  colDiscount: { width: "8%", textAlign: "right" },
  colAmount: { width: "14%", textAlign: "right" },

  // =====================
  // TOTALS SECTION
  // =====================
  totalsContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 24,
  },
  totalsCard: {
    width: 240,
    backgroundColor: colors.background,
    borderRadius: 6,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  totalsBox: {
    width: 240,
    backgroundColor: colors.background,
    borderRadius: 6,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  totalsLabel: {
    fontSize: 9,
    color: colors.muted,
  },
  totalsValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
  totalsDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 2,
    borderTopColor: colors.accent,
  },
  grandTotalLabel: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
  grandTotalValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: colors.accent,
  },

  // =====================
  // NOTES & TERMS
  // =====================
  notesSection: {
    marginBottom: 20,
  },
  notesBox: {
    backgroundColor: colors.background,
    borderRadius: 6,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  notesTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  notesText: {
    fontSize: 8,
    color: colors.muted,
    lineHeight: 1.6,
  },

  // =====================
  // BANK DETAILS
  // =====================
  bankSection: {
    backgroundColor: colors.accentLight,
    borderRadius: 6,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    marginBottom: 20,
  },
  bankTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    marginBottom: 10,
  },
  bankGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  bankItem: {
    width: "45%",
  },
  bankLabel: {
    fontSize: 7,
    color: colors.muted,
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  bankValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },

  // =====================
  // FOOTER
  // =====================
  footer: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerLeft: {
    flexDirection: "column",
  },
  footerText: {
    fontSize: 7,
    color: colors.light,
  },
  footerMotto: {
    fontSize: 8,
    color: colors.accent,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.3,
  },
  footerRight: {
    textAlign: "right",
  },
  footerPage: {
    fontSize: 8,
    color: colors.muted,
  },

  // =====================
  // LEGACY SUPPORT (for existing components)
  // =====================
  partySection: {
    flexDirection: "row",
    marginBottom: 24,
    gap: 16,
  },
  partyBox: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 6,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  partyLabel: {
    fontSize: 8,
    color: colors.light,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontFamily: "Helvetica-Bold",
  },
  partyName: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    marginBottom: 4,
  },
  partyDetail: {
    fontSize: 9,
    color: colors.secondary,
    marginBottom: 2,
    lineHeight: 1.5,
  },
  detailsSection: {
    flexDirection: "row",
    marginBottom: 24,
    gap: 12,
    flexWrap: "wrap",
  },
  detailBox: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.background,
    borderRadius: 4,
    minWidth: 100,
    borderWidth: 1,
    borderColor: colors.border,
  },
  motto: {
    fontSize: 8,
    color: colors.accent,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.3,
  },
  footerCenter: {
    textAlign: "center",
    flex: 1,
  },
});

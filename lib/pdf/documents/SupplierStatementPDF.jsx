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
  danger: "#dc2626",
  warning: "#f59e0b",
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
  statementHeader: {
    alignItems: "flex-end",
  },
  statementTitle: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
  },
  statementSubtitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
    marginTop: 4,
  },
  statementDate: {
    fontSize: 8,
    color: colors.gray,
    marginTop: 2,
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
  supplierBox: {
    flex: 1,
    backgroundColor: colors.grayLightest,
    padding: 12,
    borderRadius: 4,
    marginRight: 10,
  },
  periodBox: {
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

  // Summary Cards
  summaryRow: {
    flexDirection: "row",
    marginBottom: 15,
  },
  summaryCard: {
    flex: 1,
    padding: 10,
    backgroundColor: colors.grayLightest,
    borderRadius: 4,
    marginRight: 8,
    alignItems: "center",
  },
  summaryCardLast: {
    marginRight: 0,
  },
  summaryCardHighlight: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  summaryLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.gray,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
  },
  summaryValueSuccess: {
    color: colors.success,
  },
  summaryValueDanger: {
    color: colors.danger,
  },

  // Table
  table: {
    marginBottom: 15,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.white,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.grayLight,
  },
  tableRowAlt: {
    backgroundColor: colors.grayLightest,
  },
  tableCell: {
    fontSize: 8,
    color: colors.dark,
  },
  tableCellBold: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },
  tableCellSub: {
    fontSize: 6,
    color: colors.gray,
    marginTop: 1,
  },

  // Columns
  colDate: { width: "12%" },
  colRef: { width: "15%" },
  colDesc: { width: "33%" },
  colDebit: { width: "13%", textAlign: "right" },
  colCredit: { width: "13%", textAlign: "right" },
  colBalance: { width: "14%", textAlign: "right" },

  // Opening/Closing Balance Rows
  balanceRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: colors.primaryLight,
  },
  closingBalanceRow: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: colors.primary,
  },
  balanceLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
  },
  closingBalanceLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: colors.white,
  },
  closingBalanceValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: colors.white,
  },

  // Aging Section
  agingSection: {
    marginTop: 15,
    padding: 12,
    backgroundColor: colors.grayLightest,
    borderRadius: 4,
  },
  agingTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginBottom: 10,
    color: colors.dark,
  },
  agingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  agingItem: {
    alignItems: "center",
    flex: 1,
  },
  agingLabel: {
    fontSize: 7,
    color: colors.gray,
    marginBottom: 3,
  },
  agingValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.dark,
  },
  agingValueWarning: {
    color: colors.warning,
  },
  agingValueDanger: {
    color: colors.danger,
  },

  // Notes
  notes: {
    marginTop: 15,
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

const getTransactionTypeLabel = (type) => {
  const labels = {
    bill: "BILL",
    payment: "PMT",
  };
  return labels[type] || type.toUpperCase();
};

// ============================================
// SUPPLIER STATEMENT PDF COMPONENT
// ============================================
export const SupplierStatementPDF = ({ statement, company }) => {
  const { supplier, transactions, summary, aging, period } = statement;

  return (
    <Document title={`Supplier Statement - ${supplier.name}`}>
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
          <View style={styles.statementHeader}>
            <Text style={styles.statementTitle}>SUPPLIER</Text>
            <Text style={styles.statementSubtitle}>STATEMENT</Text>
            <Text style={styles.statementDate}>
              Generated: {formatDate(statement.generatedAt)}
            </Text>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Supplier & Period Info */}
        <View style={styles.infoRow}>
          <View style={styles.supplierBox}>
            <Text style={styles.label}>Supplier</Text>
            <Text style={styles.valueBold}>
              {supplier.displayName || supplier.name}
            </Text>
            <Text style={styles.value}>
              {formatAddress(supplier.address)}
              {supplier.phone && `\n${supplier.phone}`}
              {supplier.email && `\n${supplier.email}`}
              {supplier.taxPin && `\nPIN: ${supplier.taxPin}`}
            </Text>
          </View>
          <View style={styles.periodBox}>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Statement Period</Text>
              <Text style={styles.valueBold}>
                {period.startDate && period.endDate
                  ? `${formatDate(period.startDate)} - ${formatDate(period.endDate)}`
                  : "All Time"}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Payment Terms</Text>
              <Text style={styles.value}>
                Net {supplier.creditTerms?.paymentTermsDays || 30} Days
              </Text>
            </View>
          </View>
        </View>

        {/* Summary Cards */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Opening Balance</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(summary.openingBalance)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Billed</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(summary.totalBilled)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Paid</Text>
            <Text style={[styles.summaryValue, styles.summaryValueSuccess]}>
              {formatCurrency(summary.totalPaid)}
            </Text>
          </View>
          <View
            style={[
              styles.summaryCard,
              styles.summaryCardLast,
              styles.summaryCardHighlight,
            ]}
          >
            <Text style={styles.summaryLabel}>Balance Owed</Text>
            <Text
              style={[
                styles.summaryValue,
                summary.closingBalance > 0 && styles.summaryValueDanger,
              ]}
            >
              {formatCurrency(summary.closingBalance)}
            </Text>
          </View>
        </View>

        {/* Transactions Table */}
        <View style={styles.table}>
          {/* Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colDate]}>Date</Text>
            <Text style={[styles.tableHeaderCell, styles.colRef]}>Reference</Text>
            <Text style={[styles.tableHeaderCell, styles.colDesc]}>
              Description
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colDebit]}>Paid</Text>
            <Text style={[styles.tableHeaderCell, styles.colCredit]}>Billed</Text>
            <Text style={[styles.tableHeaderCell, styles.colBalance]}>Balance</Text>
          </View>

          {/* Opening Balance Row */}
          {summary.openingBalance !== 0 && (
            <View style={styles.balanceRow}>
              <Text style={[styles.balanceLabel, { width: "60%" }]}>
                Opening Balance
              </Text>
              <Text style={[styles.balanceLabel, styles.colDebit]}></Text>
              <Text style={[styles.balanceLabel, styles.colCredit]}></Text>
              <Text
                style={[styles.balanceLabel, styles.colBalance, { textAlign: "right" }]}
              >
                {formatCurrency(summary.openingBalance)}
              </Text>
            </View>
          )}

          {/* Transaction Rows */}
          {transactions.map((txn, i) => (
            <View
              key={i}
              style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}
            >
              <Text style={[styles.tableCell, styles.colDate]}>
                {formatDate(txn.date)}
              </Text>
              <View style={styles.colRef}>
                <Text style={styles.tableCellBold}>
                  {getTransactionTypeLabel(txn.type)}
                </Text>
                <Text style={styles.tableCellSub}>{txn.reference}</Text>
              </View>
              <View style={styles.colDesc}>
                <Text style={styles.tableCell}>{txn.description}</Text>
                {txn.dueDate && txn.type === "bill" && (
                  <Text style={styles.tableCellSub}>
                    Due: {formatDate(txn.dueDate)}
                  </Text>
                )}
              </View>
              <Text
                style={[styles.tableCell, styles.colDebit, { color: colors.success }]}
              >
                {txn.debit > 0 ? formatCurrency(txn.debit) : ""}
              </Text>
              <Text style={[styles.tableCell, styles.colCredit]}>
                {txn.credit > 0 ? formatCurrency(txn.credit) : ""}
              </Text>
              <Text style={[styles.tableCellBold, styles.colBalance]}>
                {formatCurrency(txn.balance)}
              </Text>
            </View>
          ))}

          {/* Closing Balance Row */}
          <View style={styles.closingBalanceRow}>
            <Text style={[styles.closingBalanceLabel, { width: "60%" }]}>
              Closing Balance
            </Text>
            <Text style={[styles.closingBalanceLabel, styles.colDebit]}></Text>
            <Text style={[styles.closingBalanceLabel, styles.colCredit]}></Text>
            <Text
              style={[
                styles.closingBalanceValue,
                styles.colBalance,
                { textAlign: "right" },
              ]}
            >
              {formatCurrency(summary.closingBalance)}
            </Text>
          </View>
        </View>

        {/* Aging Section */}
        {(aging.days30 > 0 || aging.days60 > 0 || aging.days90 > 0 || aging.over90 > 0) && (
          <View style={styles.agingSection}>
            <Text style={styles.agingTitle}>Payables Aging</Text>
            <View style={styles.agingRow}>
              <View style={styles.agingItem}>
                <Text style={styles.agingLabel}>Current</Text>
                <Text style={styles.agingValue}>
                  {formatCurrency(aging.current)}
                </Text>
              </View>
              <View style={styles.agingItem}>
                <Text style={styles.agingLabel}>1-30 Days</Text>
                <Text
                  style={[
                    styles.agingValue,
                    aging.days30 > 0 && styles.agingValueWarning,
                  ]}
                >
                  {formatCurrency(aging.days30)}
                </Text>
              </View>
              <View style={styles.agingItem}>
                <Text style={styles.agingLabel}>31-60 Days</Text>
                <Text
                  style={[
                    styles.agingValue,
                    aging.days60 > 0 && styles.agingValueWarning,
                  ]}
                >
                  {formatCurrency(aging.days60)}
                </Text>
              </View>
              <View style={styles.agingItem}>
                <Text style={styles.agingLabel}>61-90 Days</Text>
                <Text
                  style={[
                    styles.agingValue,
                    aging.days90 > 0 && styles.agingValueDanger,
                  ]}
                >
                  {formatCurrency(aging.days90)}
                </Text>
              </View>
              <View style={styles.agingItem}>
                <Text style={styles.agingLabel}>Over 90 Days</Text>
                <Text
                  style={[
                    styles.agingValue,
                    aging.over90 > 0 && styles.agingValueDanger,
                  ]}
                >
                  {formatCurrency(aging.over90)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Note */}
        <View style={styles.notes}>
          <Text style={styles.notesTitle}>Internal Record</Text>
          <Text style={styles.notesText}>
            This statement reflects our records of transactions with {supplier.name}.
            For any discrepancies, please contact {company.email} or {company.phone}.
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {company.name} | {company.phone} | {company.email}
          </Text>
          <Text style={styles.footerNote}>
            Supplier Statement - {supplier.name}
          </Text>
        </View>
      </Page>
    </Document>
  );
};

export default SupplierStatementPDF;

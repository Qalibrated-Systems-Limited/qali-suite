"use client";

import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";
import { useState, useEffect } from "react";
import { PDFDownloadLink } from "@react-pdf/renderer";
import { Download } from "lucide-react";

// Smart compact styles - fits most invoices on one page
const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 8,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
  },

  // Compact Header with Logo
  headerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 15,
    paddingBottom: 10,
    borderBottom: "2px solid #eab308",
  },
  logoSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoContainer: {
    width: 55,
    height: 55,
  },
  logo: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  logoPlaceholder: {
    width: 55,
    height: 55,
    backgroundColor: "#eab308",
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  logoText: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#000000",
  },
  companyInfo: {
    marginLeft: 10,
  },
  companyName: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 2,
  },
  companyDetails: {
    fontSize: 7,
    color: "#64748b",
    lineHeight: 1.2,
  },
  invoiceTitleSection: {
    alignItems: "flex-end",
  },
  invoiceTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#eab308",
    marginBottom: 3,
  },
  invoiceNumber: {
    fontSize: 8,
    color: "#0f172a",
    fontWeight: "bold",
    marginBottom: 1,
  },
  invoiceDate: {
    fontSize: 7,
    color: "#64748b",
  },

  // Compact Info Row (Invoice details)
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    padding: 8,
    backgroundColor: "#fefce8",
    borderRadius: 3,
  },
  infoItem: {
    width: "32%",
  },
  infoLabel: {
    fontSize: 6,
    color: "#64748b",
    fontWeight: "bold",
    textTransform: "uppercase",
    marginBottom: 3,
  },
  infoValue: {
    fontSize: 8,
    color: "#0f172a",
    fontWeight: "bold",
  },
  statusBadge: {
    backgroundColor: "#eab308",
    color: "#000000",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
    fontSize: 7,
    fontWeight: "bold",
    alignSelf: "flex-start",
  },

  // Compact Parties Section
  partiesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
  },
  partyBox: {
    width: "48%",
    padding: 8,
    backgroundColor: "#ffffff",
    border: "1.5px solid #eab308",
    borderRadius: 3,
  },
  partyTitle: {
    fontSize: 7,
    fontWeight: "bold",
    color: "#eab308",
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  partyName: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 3,
  },
  partyText: {
    fontSize: 7,
    color: "#475569",
    marginBottom: 1.5,
    lineHeight: 1.2,
  },
  partyEmail: {
    fontSize: 7,
    color: "#eab308",
    marginBottom: 1.5,
  },

  // Compact Notes (only if present)
  notesSection: {
    marginBottom: 10,
    padding: 6,
    backgroundColor: "#fef3c7",
    borderRadius: 2,
    borderLeft: "2px solid #eab308",
  },
  notesTitle: {
    fontSize: 7,
    fontWeight: "bold",
    color: "#92400e",
    marginBottom: 3,
  },
  notesText: {
    fontSize: 7,
    color: "#78350f",
    lineHeight: 1.3,
  },

  // Compact Table
  table: {
    marginBottom: 10,
    border: "1px solid #e2e8f0",
    borderRadius: 2,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#eab308",
    padding: 5,
  },
  tableHeaderText: {
    fontSize: 7,
    fontWeight: "bold",
    color: "#000000",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "1px solid #e2e8f0",
    padding: 5,
    minHeight: 22,
    alignItems: "center",
  },
  tableRowAlt: {
    backgroundColor: "#fffbeb",
  },
  tableCell: {
    fontSize: 7,
    color: "#475569",
  },
  tableCellBold: {
    fontSize: 8,
    color: "#0f172a",
    fontWeight: "bold",
  },
  itemDescription: {
    fontSize: 6,
    color: "#64748b",
    marginTop: 1,
  },

  // Column widths
  colDescription: { width: "40%" },
  colQuantity: { width: "11%", textAlign: "center" },
  colUnit: { width: "12%", textAlign: "center" },
  colUnitPrice: { width: "18%", textAlign: "right" },
  colTotal: { width: "19%", textAlign: "right" },

  // Compact Summary Section
  summaryContainer: {
    marginTop: 10,
    marginLeft: "auto",
    width: "48%",
  },
  summaryBox: {
    border: "1.5px solid #fef3c7",
    borderRadius: 3,
    padding: 6,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  summaryLabel: {
    fontSize: 7,
    color: "#64748b",
  },
  summaryValue: {
    fontSize: 8,
    color: "#0f172a",
    fontWeight: "bold",
  },
  summaryDivider: {
    borderTop: "1px dashed #cbd5e1",
    marginVertical: 3,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#eab308",
    padding: 8,
    borderRadius: 2,
    marginTop: 5,
  },
  totalLabel: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#000000",
    textTransform: "uppercase",
  },
  totalValue: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#000000",
  },

  // Compact Payment Status (if paid)
  paymentStatusBox: {
    marginTop: 6,
    padding: 5,
    backgroundColor: "#f0fdf4",
    border: "1px solid #86efac",
    borderRadius: 2,
  },
  paymentStatusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  paymentStatusLabel: {
    fontSize: 7,
    color: "#15803d",
  },
  paymentStatusValue: {
    fontSize: 7,
    color: "#166534",
    fontWeight: "bold",
  },
  balanceDueBox: {
    marginTop: 5,
    padding: 5,
    backgroundColor: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 2,
  },
  balanceDueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  balanceDueLabel: {
    fontSize: 8,
    color: "#991b1b",
    fontWeight: "bold",
  },
  balanceDueValue: {
    fontSize: 9,
    color: "#dc2626",
    fontWeight: "bold",
  },

  // Compact Payment Information
  paymentInfoSection: {
    marginTop: 12,
    padding: 8,
    backgroundColor: "#fefce8",
    borderRadius: 3,
    border: "1.5px solid #eab308",
  },
  paymentInfoTitle: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#eab308",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  paymentInfoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  paymentInfoItem: {
    width: "48%",
  },
  paymentInfoLabel: {
    fontSize: 6,
    color: "#64748b",
    fontWeight: "bold",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  paymentInfoValue: {
    fontSize: 7,
    color: "#0f172a",
    fontWeight: "bold",
  },

  // Compact Footer
  footer: {
    marginTop: 12,
    paddingTop: 8,
    borderTop: "1px solid #e2e8f0",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerLeft: {
    width: "65%",
  },
  footerBold: {
    fontSize: 9,
    color: "#eab308",
    fontWeight: "bold",
    marginBottom: 2,
  },
  footerText: {
    fontSize: 6,
    color: "#64748b",
    lineHeight: 1.3,
  },
  footerRight: {
    width: "30%",
    alignItems: "flex-end",
  },
  footerWebsite: {
    fontSize: 7,
    color: "#eab308",
    fontWeight: "bold",
    marginBottom: 1,
  },
  footerContact: {
    fontSize: 6,
    color: "#64748b",
  },
});

// Helper functions
const formatNumber = (value) => {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// Main Invoice PDF Document
function InvoicePDFDocument({
  invoice,
  logoUrl = null,
  companyInfo = {
    name: "Your Company Name",
    tagline: "Professional Business Solutions",
    address: "123 Business Street, Nairobi, Kenya",
    phone: "+254 700 000 000",
    email: "info@yourcompany.com",
    website: "www.yourcompany.com",
  },
}) {
  const currency = invoice.currency || "KES";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Compact Header with Logo */}
        <View style={styles.headerContainer}>
          <View style={styles.logoSection}>
            {/* Logo */}
            {logoUrl ? (
              <View style={styles.logoContainer}>
                <Image src={logoUrl} style={styles.logo} />
              </View>
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoText}>
                  {companyInfo.name.charAt(0)}
                </Text>
              </View>
            )}

            {/* Company Info */}
            <View style={styles.companyInfo}>
              <Text style={styles.companyName}>{companyInfo.name}</Text>
              <Text style={styles.companyDetails}>{formatAddress(companyInfo.address)}</Text>
              <Text style={styles.companyDetails}>
                {companyInfo.phone} • {companyInfo.email}
              </Text>
            </View>
          </View>

          {/* Invoice Title */}
          <View style={styles.invoiceTitleSection}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>#{invoice.invoiceNumber}</Text>
            <Text style={styles.invoiceDate}>
              {formatDate(invoice.invoiceDate)}
            </Text>
          </View>
        </View>

        {/* Compact Info Row */}
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Invoice Date</Text>
            <Text style={styles.infoValue}>
              {formatDate(invoice.invoiceDate)}
            </Text>
          </View>
          {invoice.dueDate && (
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Due Date</Text>
              <Text style={styles.infoValue}>
                {formatDate(invoice.dueDate)}
              </Text>
            </View>
          )}
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Status</Text>
            <View style={styles.statusBadge}>
              <Text>{invoice.status.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {/* Bill To and From */}
        <View style={styles.partiesRow}>
          <View style={styles.partyBox}>
            <Text style={styles.partyTitle}>Bill To</Text>
            <Text style={styles.partyName}>{invoice.customer.name}</Text>
            <Text style={styles.partyText}>{formatAddress(invoice.customer.address)}</Text>
            {invoice.customer.email && (
              <Text style={styles.partyEmail}>{invoice.customer.email}</Text>
            )}
            {invoice.customer.phone && (
              <Text style={styles.partyText}>{invoice.customer.phone}</Text>
            )}
          </View>

          <View style={styles.partyBox}>
            <Text style={styles.partyTitle}>From</Text>
            <Text style={styles.partyName}>{companyInfo.name}</Text>
            <Text style={styles.partyText}>{formatAddress(companyInfo.address)}</Text>
            <Text style={styles.partyEmail}>{companyInfo.email}</Text>
            <Text style={styles.partyText}>{companyInfo.phone}</Text>
          </View>
        </View>

        {/* Notes (only if present) */}
        {invoice.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        )}

        {/* Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, styles.colDescription]}>
              Description
            </Text>
            <Text style={[styles.tableHeaderText, styles.colQuantity]}>
              Qty
            </Text>
            <Text style={[styles.tableHeaderText, styles.colUnit]}>Unit</Text>
            <Text style={[styles.tableHeaderText, styles.colUnitPrice]}>
              Unit Price
            </Text>
            <Text style={[styles.tableHeaderText, styles.colTotal]}>Total</Text>
          </View>

          {invoice.items.map((item, index) => (
            <View
              key={index}
              style={[
                styles.tableRow,
                index % 2 === 1 ? styles.tableRowAlt : null,
              ]}
            >
              <View style={styles.colDescription}>
                <Text style={styles.tableCellBold}>{item.name}</Text>
                {item.description && (
                  <Text style={styles.itemDescription}>{item.description}</Text>
                )}
              </View>
              <Text style={[styles.tableCell, styles.colQuantity]}>
                {item.quantity}
              </Text>
              <Text style={[styles.tableCell, styles.colUnit]}>
                {item.unit}
              </Text>
              <Text style={[styles.tableCell, styles.colUnitPrice]}>
                {currency} {formatNumber(item.unitPrice)}
              </Text>
              <Text style={[styles.tableCellBold, styles.colTotal]}>
                {currency} {formatNumber(item.total)}
              </Text>
            </View>
          ))}
        </View>

        {/* Summary */}
        <View style={styles.summaryContainer}>
          <View style={styles.summaryBox}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>
                {currency} {formatNumber(invoice.subtotal)}
              </Text>
            </View>

            {invoice.discountAmount > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  Discount ({invoice.discountPercentage}%)
                </Text>
                <Text style={styles.summaryValue}>
                  - {currency} {formatNumber(invoice.discountAmount)}
                </Text>
              </View>
            )}

            {invoice.taxAmount > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  Tax ({invoice.taxRate}%)
                </Text>
                <Text style={styles.summaryValue}>
                  {currency} {formatNumber(invoice.taxAmount)}
                </Text>
              </View>
            )}

            <View style={styles.summaryDivider} />

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>
                {currency} {formatNumber(invoice.total)}
              </Text>
            </View>
          </View>

          {/* Payment Status (if paid) */}
          {invoice.amountPaid > 0 && (
            <View style={styles.paymentStatusBox}>
              <View style={styles.paymentStatusRow}>
                <Text style={styles.paymentStatusLabel}>Paid</Text>
                <Text style={styles.paymentStatusValue}>
                  {currency} {formatNumber(invoice.amountPaid)}
                </Text>
              </View>
              {invoice.paymentReference && (
                <View style={styles.paymentStatusRow}>
                  <Text style={styles.paymentStatusLabel}>Ref</Text>
                  <Text style={styles.paymentStatusValue}>
                    {invoice.paymentReference}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Balance Due */}
          {invoice.amountPaid > 0 && invoice.amountPaid < invoice.total && (
            <View style={styles.balanceDueBox}>
              <View style={styles.balanceDueRow}>
                <Text style={styles.balanceDueLabel}>Balance Due</Text>
                <Text style={styles.balanceDueValue}>
                  {currency} {formatNumber(invoice.total - invoice.amountPaid)}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Payment Information */}
        <View style={styles.paymentInfoSection}>
          <Text style={styles.paymentInfoTitle}>💳 Payment Details</Text>
          <View style={styles.paymentInfoGrid}>
            <View style={styles.paymentInfoItem}>
              <Text style={styles.paymentInfoLabel}>Bank</Text>
              <Text style={styles.paymentInfoValue}>Equity Bank Kenya</Text>
            </View>
            <View style={styles.paymentInfoItem}>
              <Text style={styles.paymentInfoLabel}>Account</Text>
              <Text style={styles.paymentInfoValue}>1234567890</Text>
            </View>
            <View style={styles.paymentInfoItem}>
              <Text style={styles.paymentInfoLabel}>Account Name</Text>
              <Text style={styles.paymentInfoValue}>{companyInfo.name}</Text>
            </View>
            <View style={styles.paymentInfoItem}>
              <Text style={styles.paymentInfoLabel}>SWIFT</Text>
              <Text style={styles.paymentInfoValue}>EQBLKENA</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            <Text style={styles.footerBold}>Thank You For Your Business!</Text>
            <Text style={styles.footerText}>
              Questions? Contact us at {companyInfo.email}
            </Text>
          </View>
          <View style={styles.footerRight}>
            <Text style={styles.footerWebsite}>{companyInfo.website}</Text>
            <Text style={styles.footerContact}>{companyInfo.phone}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export default InvoicePDFDocument;

export function DownloadInvoicePDF({
  invoice,
  logoUrl = "/qsl.png", // Optional: "/logo.png" or "https://yoursite.com/logo.png"
  companyInfo = {
    name: "Qalibrated Systems",
    tagline: "Inventing and Making Happen",
    address: "QSL Center, Mombasa RD",
    phone: "+254714999996.",
    email: "info@qalibrated.co.ke",
    website: "www.qalibrated.co.ke",
  },
}) {
  const [isClient, setIsClient] = useState(false);

  // Wait for client-side hydration
  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="flex items-center text-sm text-muted-foreground cursor-not-allowed">
        <Download className="mr-2 h-4 w-4" />
        Download PDF
      </div>
    );
  }

  return (
    <PDFDownloadLink
      document={
        <InvoicePDFDocument
          invoice={invoice}
          logoUrl={logoUrl}
          companyInfo={companyInfo}
        />
      }
      fileName={`invoice-${invoice.invoiceNumber}.pdf`}
      className="flex items-center text-sm w-full hover:bg-accent px-2 py-1.5 rounded-sm transition-colors"
    >
      {({ loading }) => (
        <>
          <Download className="mr-2 h-4 w-4" />
          {loading ? "Preparing PDF..." : "Download PDF"}
        </>
      )}
    </PDFDownloadLink>
  );
}

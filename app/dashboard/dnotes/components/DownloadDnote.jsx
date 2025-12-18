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

// Clean styles for delivery notes
const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 8,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
  },

  // Header with Logo
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
  dnTitleSection: {
    alignItems: "flex-end",
  },
  dnTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#eab308",
    marginBottom: 3,
  },
  dnNumber: {
    fontSize: 8,
    color: "#0f172a",
    fontWeight: "bold",
    marginBottom: 1,
  },
  dnDate: {
    fontSize: 7,
    color: "#64748b",
  },

  // Info Row
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    padding: 8,
    backgroundColor: "#fefce8",
    borderRadius: 3,
  },
  infoItem: {
    width: "48%",
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
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
    fontSize: 7,
    fontWeight: "bold",
    alignSelf: "flex-start",
  },
  typeBadgeSale: {
    backgroundColor: "#dcfce7",
    color: "#166534",
  },
  typeBadgeReturnable: {
    backgroundColor: "#fed7aa",
    color: "#9a3412",
  },

  // Parties Section
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

  // Reason Section
  reasonSection: {
    marginBottom: 10,
    padding: 6,
    backgroundColor: "#fef3c7",
    borderRadius: 2,
    borderLeft: "2px solid #eab308",
  },
  reasonTitle: {
    fontSize: 7,
    fontWeight: "bold",
    color: "#92400e",
    marginBottom: 3,
  },
  reasonText: {
    fontSize: 7,
    color: "#78350f",
    lineHeight: 1.3,
  },

  // Items Table
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
    lineHeight: 1.3,
  },
  serialNumbers: {
    fontSize: 6,
    color: "#64748b",
    marginTop: 1,
    fontFamily: "Courier",
  },

  // Column widths (without price columns)
  colItem: { width: "40%" },
  colSKU: { width: "20%" },
  colType: { width: "15%" },
  colQuantity: { width: "12%", textAlign: "center" },
  colUnit: { width: "13%", textAlign: "center" },

  // Summary Section
  summaryContainer: {
    marginTop: 10,
    marginLeft: "auto",
    width: "35%",
  },
  summaryBox: {
    border: "1.5px solid #fef3c7",
    borderRadius: 3,
    padding: 8,
    backgroundColor: "#fefce8",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  summaryLabel: {
    fontSize: 8,
    color: "#64748b",
    fontWeight: "bold",
  },
  summaryValue: {
    fontSize: 10,
    color: "#0f172a",
    fontWeight: "bold",
  },

  // Notes Section
  notesSection: {
    marginTop: 12,
    padding: 8,
    backgroundColor: "#fefce8",
    borderRadius: 3,
    border: "1px solid #fde047",
  },
  notesTitle: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#eab308",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  notesText: {
    fontSize: 7,
    color: "#78350f",
    lineHeight: 1.4,
  },

  // Footer
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

  // Signature Section
  signatureSection: {
    marginTop: 20,
    paddingTop: 15,
    borderTop: "1px dashed #cbd5e1",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  signatureBox: {
    width: "45%",
  },
  signatureLabel: {
    fontSize: 7,
    color: "#64748b",
    marginBottom: 25,
  },
  signatureLine: {
    borderTop: "1px solid #cbd5e1",
    paddingTop: 3,
  },
  signatureName: {
    fontSize: 7,
    color: "#0f172a",
    fontWeight: "bold",
  },
  signatureRole: {
    fontSize: 6,
    color: "#64748b",
  },
});

// Helper functions
const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// Main Delivery Note PDF Document
function DeliveryNotePDFDocument({
  deliveryNote,
  logoUrl = null,
  companyInfo = {
    name: "Your Company Name",
    address: "123 Business Street, Nairobi, Kenya",
    phone: "+254 700 000 000",
    email: "info@yourcompany.com",
    website: "www.yourcompany.com",
  },
}) {
  // Calculate total items
  const totalItems =
    deliveryNote.items?.reduce((sum, item) => sum + (item.quantity || 0), 0) ||
    0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header with Logo */}
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
              <Text style={styles.companyDetails}>{companyInfo.address}</Text>
              <Text style={styles.companyDetails}>
                {companyInfo.phone} - {companyInfo.email}
              </Text>
            </View>
          </View>

          {/* DN Title */}
          <View style={styles.dnTitleSection}>
            <Text style={styles.dnTitle}>DELIVERY NOTE</Text>
            <Text style={styles.dnNumber}>
              Number: {deliveryNote.deliveryNumber}
            </Text>
            <Text style={styles.dnDate}>
              {formatDate(deliveryNote.date || deliveryNote.createdAt)}
            </Text>
          </View>
        </View>

        {/* Info Row */}
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Date</Text>
            <Text style={styles.infoValue}>
              {formatDate(deliveryNote.date || deliveryNote.createdAt)}
            </Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Type</Text>
            <View
              style={[
                styles.typeBadge,
                deliveryNote.shouldBeReturned
                  ? styles.typeBadgeReturnable
                  : styles.typeBadgeSale,
              ]}
            >
              <Text>
                {deliveryNote.shouldBeReturned ? "RETURNABLE" : "SALE"}
              </Text>
            </View>
          </View>
        </View>

        {/* Delivered To and From */}
        <View style={styles.partiesRow}>
          <View style={styles.partyBox}>
            <Text style={styles.partyTitle}>DELIVERED TO</Text>
            <Text style={styles.partyName}>
              {deliveryNote.customer?.name || "N/A"}
            </Text>
            {deliveryNote.customer?.address && (
              <Text style={styles.partyText}>
                {deliveryNote.customer.address}
              </Text>
            )}
            {deliveryNote.customer?.phone && (
              <Text style={styles.partyText}>
                Phone: {deliveryNote.customer.phone}
              </Text>
            )}
            {deliveryNote.customer?.email && (
              <Text style={styles.partyEmail}>
                {deliveryNote.customer.email}
              </Text>
            )}
          </View>

          <View style={styles.partyBox}>
            <Text style={styles.partyTitle}>DELIVERED FROM</Text>
            <Text style={styles.partyName}>{companyInfo.name}</Text>
            <Text style={styles.partyText}>{companyInfo.address}</Text>
            <Text style={styles.partyEmail}>{companyInfo.email}</Text>
            <Text style={styles.partyText}>Phone: {companyInfo.phone}</Text>
          </View>
        </View>

        {/* Technician Info */}
        {deliveryNote.technician?.name && (
          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Technician</Text>
              <Text style={styles.infoValue}>
                {deliveryNote.technician.name}
              </Text>
            </View>
            {deliveryNote.createdBy?.name && (
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Prepared By</Text>
                <Text style={styles.infoValue}>
                  {deliveryNote.createdBy.name}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Reason */}
        {deliveryNote.reason && (
          <View style={styles.reasonSection}>
            <Text style={styles.reasonTitle}>REASON</Text>
            <Text style={styles.reasonText}>{deliveryNote.reason}</Text>
          </View>
        )}

        {/* Items Table - NO PRICES */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, styles.colItem]}>
              ITEM NAME
            </Text>
            <Text style={[styles.tableHeaderText, styles.colSKU]}>SKU/ID</Text>
            <Text style={[styles.tableHeaderText, styles.colType]}>TYPE</Text>
            <Text style={[styles.tableHeaderText, styles.colQuantity]}>
              QUANTITY
            </Text>
            <Text style={[styles.tableHeaderText, styles.colUnit]}>UNIT</Text>
          </View>

          {deliveryNote.items?.map((item, index) => (
            <View
              key={index}
              style={[
                styles.tableRow,
                index % 2 === 1 ? styles.tableRowAlt : null,
              ]}
            >
              <View style={styles.colItem}>
                <Text style={styles.tableCellBold}>{item.name || "N/A"}</Text>
                {/* Serial Numbers */}
                {item.serialNo && item.serialNo.length > 0 && (
                  <Text style={styles.serialNumbers}>
                    Serial: {item.serialNo.join(", ")}
                  </Text>
                )}
              </View>
              <Text style={[styles.tableCell, styles.colSKU]}>
                {item.id || "-"}
              </Text>
              <Text style={[styles.tableCell, styles.colType]}>
                {item.type || "Stock"}
              </Text>
              <Text style={[styles.tableCell, styles.colQuantity]}>
                {item.quantity || 0}
              </Text>
              <Text style={[styles.tableCell, styles.colUnit]}>
                {item.unit || "pcs"}
              </Text>
            </View>
          ))}
        </View>

        {/* Summary - NO MONEY */}
        <View style={styles.summaryContainer}>
          <View style={styles.summaryBox}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total Items:</Text>
              <Text style={styles.summaryValue}>{totalItems}</Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {deliveryNote.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesTitle}>NOTES</Text>
            <Text style={styles.notesText}>{deliveryNote.notes}</Text>
          </View>
        )}

        {/* Signature Section */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLabel}>Delivered By:</Text>
            <View style={styles.signatureLine}>
              <Text style={styles.signatureName}>
                {deliveryNote.createdBy?.name || "________________"}
              </Text>
              <Text style={styles.signatureRole}>Authorized Signature</Text>
            </View>
          </View>

          <View style={styles.signatureBox}>
            <Text style={styles.signatureLabel}>Received By:</Text>
            <View style={styles.signatureLine}>
              <Text style={styles.signatureName}>________________</Text>
              <Text style={styles.signatureRole}>Customer Signature</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            <Text style={styles.footerBold}>
              {deliveryNote.shouldBeReturned
                ? "NOTE: This equipment must be returned by the specified date"
                : "Thank You For Your Business!"}
            </Text>
            <Text style={styles.footerText}>
              Questions? Contact us at {companyInfo.email} or{" "}
              {companyInfo.phone}
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

export default DeliveryNotePDFDocument;

// Download Component
export function DownloadDeliveryNotePDF({
  deliveryNote,
  logoUrl = "/qsl.png",
  companyInfo = {
    name: "Qalibrated Systems",
    address: "QSL Center, Mombasa RD, Nairobi",
    phone: "+254714999996",
    email: "info@qalibrated.co.ke",
    website: "www.qalibrated.co.ke",
  },
}) {
  const [isClient, setIsClient] = useState(false);

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
        <DeliveryNotePDFDocument
          deliveryNote={deliveryNote}
          logoUrl={logoUrl}
          companyInfo={companyInfo}
        />
      }
      fileName={`delivery-note-${deliveryNote.deliveryNumber}.pdf`}
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

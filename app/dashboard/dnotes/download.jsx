"use client";

import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  PDFDownloadLink,
} from "@react-pdf/renderer";
import moment from "moment";
import { PrinterIcon } from "lucide-react";

// Styles with black and yellow theme
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
  },
  header: {
    backgroundColor: "#000000",
    padding: 20,
    marginBottom: 25,
    borderBottom: "4 solid #FFD700",
  },
  companyName: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#FFD700",
    marginBottom: 5,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#FFD700",
    letterSpacing: 1,
  },
  headerText: {
    color: "#ffffff",
    fontSize: 10,
    marginTop: 3,
  },
  section: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: "#f8f8f8",
    borderLeft: "3 solid #FFD700",
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#000000",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  customerText: {
    fontSize: 10,
    color: "#333333",
    marginTop: 3,
  },
  tableContainer: {
    marginTop: 20,
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#000000",
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  tableHeaderText: {
    color: "#FFD700",
    fontWeight: "bold",
    fontSize: 10,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottom: "1 solid #e0e0e0",
  },
  tableRowAlt: {
    backgroundColor: "#fafafa",
  },
  cell: {
    flex: 1,
    paddingHorizontal: 4,
    fontSize: 10,
    color: "#333333",
  },
  cellSmall: {
    flex: 0.5,
  },
  cellLarge: {
    flex: 1.5,
  },
  cellRight: {
    textAlign: "right",
  },
  notesSection: {
    marginTop: 10,
    padding: 15,
    backgroundColor: "#fffbea",
    borderLeft: "3 solid #FFD700",
  },
  notesText: {
    fontSize: 10,
    color: "#333333",
    lineHeight: 1.5,
  },
  footer: {
    marginTop: 30,
    paddingTop: 15,
    borderTop: "2 solid #000000",
  },
  footerText: {
    fontSize: 10,
    color: "#666666",
  },
  signatureSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 50,
    paddingTop: 20,
  },
  signBox: {
    width: "48%",
  },
  signLabel: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#000000",
    marginBottom: 5,
  },
  signLine: {
    marginTop: 30,
    borderBottom: "2 solid #000000",
    marginBottom: 5,
  },
  signText: {
    fontSize: 9,
    color: "#666666",
    textAlign: "center",
  },
  badge: {
    backgroundColor: "#FFD700",
    color: "#000000",
    padding: 5,
    fontSize: 9,
    fontWeight: "bold",
    borderRadius: 3,
  },
});

const DNotePDF = ({ data }) => {
  const {
    deliveryNumber,
    customer,
    items,
    createdBy,
    notes,
    date,
    technician,
  } = data;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header with black and yellow theme */}
        <View style={styles.header}>
          <Text style={styles.companyName}>QALIBRATED SYSTEMS LTD</Text>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>DELIVERY NOTE</Text>
            </View>
            <View>
              <Text style={styles.headerText}>
                Delivery No: {deliveryNumber}
              </Text>
              <Text style={styles.headerText}>
                Date: {moment(date).format("DD/MM/YYYY")}
              </Text>
            </View>
          </View>
        </View>

        {/* Customer Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer Information</Text>
          <Text style={styles.customerText}>{customer.name}</Text>
          <Text style={styles.customerText}>{customer.address}</Text>
        </View>

        {/* Items Table */}
        <View style={styles.tableContainer}>
          <View style={styles.tableHeader}>
            <Text
              style={[styles.cell, styles.cellSmall, styles.tableHeaderText]}
            >
              #
            </Text>
            <Text
              style={[styles.cell, styles.cellLarge, styles.tableHeaderText]}
            >
              Item Description
            </Text>
            <Text style={[styles.cell, styles.tableHeaderText]}>Qty</Text>
            <Text style={[styles.cell, styles.tableHeaderText]}>Unit</Text>
            <Text
              style={[styles.cell, styles.tableHeaderText, styles.cellRight]}
            >
              Unit Price
            </Text>
            <Text
              style={[styles.cell, styles.tableHeaderText, styles.cellRight]}
            >
              Total
            </Text>
          </View>

          {items.map((item, i) => (
            <View
              style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}
              key={item.id}
            >
              <Text style={[styles.cell, styles.cellSmall]}>{i + 1}</Text>
              <Text style={[styles.cell, styles.cellLarge]}>{item.name}</Text>
              <Text style={styles.cell}>{item.quantity}</Text>
              <Text style={styles.cell}>{item.unit}</Text>
              <Text style={[styles.cell, styles.cellRight]}>
                {item.unitPrice.toLocaleString()}
              </Text>
              <Text style={[styles.cell, styles.cellRight]}>
                {(item.unitPrice * item.quantity).toLocaleString()}
              </Text>
            </View>
          ))}
        </View>

        {/* Notes */}
        {notes && (
          <View style={styles.notesSection}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        )}

        {/* Prepared By */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Prepared By: {createdBy.name}</Text>
        </View>

        {/* Signatures */}
        <View style={styles.signatureSection}>
          <View style={styles.signBox}>
            <Text style={styles.signLabel}>Store Manager</Text>
            <Text style={styles.customerText}>George Reru</Text>
            <View style={styles.signLine}></View>
            <Text style={styles.signText}>Signature & Date</Text>
          </View>
          <View style={styles.signBox}>
            <Text style={styles.signLabel}>Technician</Text>
            <Text style={styles.customerText}>
              {technician?.name || "________________"}
            </Text>
            <View style={styles.signLine}></View>
            <Text style={styles.signText}>Signature & Date</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};

export default DNotePDF;

// Generate PDF Link Component (unchanged)
export function GenerateDNotePDF({ dnote }) {
  const [isBrowser, setIsBrowser] = useState(false);

  useEffect(() => {
    setIsBrowser(true);
  }, []);

  return (
    <>
      {isBrowser ? (
        <PDFDownloadLink
          document={<DNotePDF data={dnote} />}
          fileName={`delivery-note-${dnote.deliveryNumber}.pdf`}
        >
          {({ loading }) =>
            loading ? (
              "Generating PDF..."
            ) : (
              <Button>
                <PrinterIcon size={20} />
                <span className="ml-2">Download</span>
              </Button>
            )
          }
        </PDFDownloadLink>
      ) : (
        <div>Loading...</div>
      )}
    </>
  );
}

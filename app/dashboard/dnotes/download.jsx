"use client";

import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
// DNotePDF.jsx

import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  PDFDownloadLink,
  Image,
} from "@react-pdf/renderer";
import moment from "moment";
import { PrinterIcon } from "lucide-react";

// Styles
const styles = StyleSheet.create({
  page: { padding: 30, fontSize: 12, fontFamily: "Helvetica" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: { fontSize: 16, fontWeight: "bold", marginBottom: 10 },
  section: { marginBottom: 10 },
  logo: { height: 80, marginBottom: 5 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontWeight: "bold" },
  tableHeader: {
    flexDirection: "row",
    borderBottom: "1 solid black",
    paddingBottom: 5,
    marginTop: 10,
  },
  tableRow: { flexDirection: "row", paddingVertical: 4 },
  cell: { flex: 1, paddingHorizontal: 4 },
  footer: { marginTop: 30, borderTop: "1 solid #ccc", paddingTop: 10 },
  signatureSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 40,
  },
  signBox: {
    width: "45%",
  },
  signLine: {
    marginTop: 20,
    borderBottom: "1 solid black",
    height: 10,
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
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.leftHeader}>
            <Image src={"/images/qls.png"} style={styles.logo} />
            <Text style={styles.bold}>Qalibrated Systems LTD</Text>
          </View>
          <View style={styles.rightHeader}>
            <Text style={styles.title}>Delivery Note</Text>
            <Text>Delivery No: {deliveryNumber}</Text>
            <Text>Date: {moment(date).format("YYYY-MM-DD")}</Text>
          </View>
        </View>

        {/* Customer Info */}
        <View style={styles.section}>
          <Text style={styles.bold}>Customer:</Text>
          <Text>{customer.name}</Text>
          <Text>{customer.address}</Text>
        </View>

        {/* Items Table */}
        <View>
          <View style={styles.tableHeader}>
            <Text style={[styles.cell, styles.bold]}>#</Text>
            <Text style={[styles.cell, styles.bold]}>Item</Text>
            <Text style={[styles.cell, styles.bold]}>Qty</Text>
            <Text style={[styles.cell, styles.bold]}>Unit</Text>
            <Text style={[styles.cell, styles.bold]}>Unit Price</Text>
            <Text style={[styles.cell, styles.bold]}>Total</Text>
          </View>

          {items.map((item, i) => (
            <View style={styles.tableRow} key={item.id}>
              <Text style={styles.cell}>{i + 1}</Text>
              <Text style={styles.cell}>{item.name}</Text>
              <Text style={styles.cell}>{item.quantity}</Text>
              <Text style={styles.cell}>{item.unit}</Text>
              <Text style={styles.cell}>{item.unitPrice.toLocaleString()}</Text>
              <Text style={styles.cell}>
                {(item.unitPrice * item.quantity).toLocaleString()}
              </Text>
            </View>
          ))}
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <Text style={styles.bold}>Notes:</Text>
          <Text>{notes}</Text>
        </View>

        {/* Prepared By */}
        <View style={styles.footer}>
          <Text>Prepared By: {createdBy.name}</Text>
        </View>

        {/* Signatures */}
        <View style={styles.signatureSection}>
          <View style={styles.signBox}>
            <Text style={styles.bold}>Store Manager: George Reru</Text>
            <View style={styles.signLine}></View>
            <Text>Signature</Text>
          </View>
          <View style={styles.signBox}>
            <Text style={styles.bold}>
              Technician: {technician?.name || "________________"}
            </Text>
            <View style={styles.signLine}></View>
            <Text>Signature</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};

export default DNotePDF;

// Generate PDF Link Component
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

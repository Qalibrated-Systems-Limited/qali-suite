"use client";

import React, { useEffect, useState } from "react";
import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  PDFDownloadLink,
} from "@react-pdf/renderer";
import { PrinterIcon } from "lucide-react";
import { Button } from "../../../components/ui/button";

// Define styles for the delivery note
const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 10,
    lineHeight: 1.5,
  },
  header: {
    fontSize: 18,
    marginBottom: 20,
    textAlign: "center",
    fontWeight: "bold",
  },
  section: {
    marginBottom: 15,
  },
  customerInfo: {
    marginBottom: 15,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottom: "1px solid #ccc",
    padding: 5,
    fontSize: 10,
  },
  bold: {
    fontWeight: "bold",
  },
  signatureSection: {
    marginTop: 20,
  },
  signatureRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  signatureBox: {
    border: "1px solid #000",
    padding: 10,
    width: "30%",
  },
  notes: {
    marginTop: 10,
    padding: 5,
    borderTop: "1px solid #ccc",
  },
  footer: {
    marginTop: 30,
    textAlign: "center",
    fontSize: 12,
  },
});

// Delivery Note PDF Component
function DNotePDF({ dnote }) {
  return (
    <Document>
      <Page style={styles.page}>
        <Text style={styles.header}>Delivery Note</Text>

        {/* Delivery Note Info */}
        <View style={styles.section}>
          <Text>Delivery Note #: {dnote.deliveryNumber}</Text>
          <Text>Date: {new Date(dnote.date).toLocaleDateString()}</Text>
        </View>

        {/* Customer Info */}
        <View style={styles.customerInfo}>
          <Text style={styles.bold}>Customer Details:</Text>
          <Text>Name: {dnote.customer.name}</Text>
          <Text>Address: {dnote.customer.address}</Text>
          {dnote.customer.phone && <Text>Phone: {dnote.customer.phone}</Text>}
          {dnote.customer.id && <Text>ID: {dnote.customer.id}</Text>}
        </View>

        {/* Item List */}
        <View style={[styles.section, { marginTop: 10 }]}>
          <View style={[styles.itemRow, styles.bold]}>
            <Text style={{ width: "50%" }}>Description</Text>
            <Text style={{ width: "15%" }}>Quantity</Text>
            <Text style={{ width: "15%" }}>Unit Price</Text>
            <Text style={{ width: "20%" }}>Amount</Text>
          </View>
          {dnote.items.map((item, index) => (
            <View style={styles.itemRow} key={index}>
              <Text style={{ width: "50%" }}>{item.description}</Text>
              <Text style={{ width: "15%" }}>{item.quantity}</Text>
              <Text style={{ width: "15%" }}>KES {item.unitPrice}</Text>
              <Text style={{ width: "20%" }}>KES {item.total}</Text>
            </View>
          ))}
        </View>

        {dnote.notes && (
          <View style={styles.notes}>
            <Text style={styles.bold}>Notes:</Text>
            <Text>{dnote.notes}</Text>
          </View>
        )}

        {/* Signatures Section */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBox}>
              <Text style={styles.bold}>Security Officer:</Text>
              <Text>Signature: ____________________</Text>
              <Text>Date: ____________________</Text>
            </View>
            <View style={styles.signatureBox}>
              <Text style={styles.bold}>Prepared By:</Text>
              <Text>Name: ____________________</Text>
              <Text>Signature: ____________________</Text>
            </View>
            <View style={styles.signatureBox}>
              <Text style={styles.bold}>Authorized By:</Text>
              <Text>Name: ____________________</Text>
              <Text>Signature: ____________________</Text>
            </View>
          </View>
          <View style={styles.signatureBox}>
            <Text style={styles.bold}>Recipient:</Text>
            <Text>Name: ____________________</Text>
            <Text>Signature: ____________________</Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          Renson Engineering Ltd - Outer Ring, Nairobi, Kenya
        </Text>
      </Page>
    </Document>
  );
}

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
          document={<DNotePDF dnote={dnote} />}
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

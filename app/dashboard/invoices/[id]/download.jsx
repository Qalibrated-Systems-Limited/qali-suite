"use client";

import React, { useEffect, useState } from "react";
import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  Image,
  PDFDownloadLink,
} from "@react-pdf/renderer";
import { PrinterIcon } from "lucide-react";
import { Button } from "../../../../components/ui/button";

// Define styles for the invoice
const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 10,
  },
  header: {
    fontSize: 20,
    marginBottom: 20,
    textAlign: "center",
    fontWeight: "bold",
  },
  section: {
    marginBottom: 10,
  },
  invoiceInfo: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottom: "1px solid #ccc",
    padding: 5,
    fontSize: 10,
  },
  footer: {
    marginTop: 20,
    textAlign: "center",
  },
  footerRowItems: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "30%",
  },
  bold: {
    fontWeight: "bold",
  },
});

// Function to build footer items
function buildFooterRowItem(title, value) {
  return (
    <View style={styles.footerRowItems}>
      <Text>{title}</Text>
      <Text>{value}</Text>
    </View>
  );
}
function InvoicePDF({
  items,
  invoice,
  total,
  subTotal,
  discount,
  taxRate,
  shoudShowSub,
}) {
  return (
    <Document>
      <Page style={styles.page}>
        {/* Company Logo */}
        <View style={{ alignItems: "center", marginBottom: 10 }}>
          <Image src="/images/qls.png" style={{ width: 200, height: 50 }} />
        </View>
        <Text style={styles.header}>INVOICE</Text>

        {/* Invoice Info Section */}
        <View style={styles.section}>
          <Text>Date: {new Date(invoice.createdAt).toLocaleDateString()}</Text>
          <Text>Invoice #: {invoice.invoiceNumber}</Text>
        </View>

        {/* Client and Company Info */}
        <View style={styles.invoiceInfo}>
          <View>
            <Text style={styles.bold}>Billing To:</Text>
            <Text>{invoice.customer.name}</Text>
            <Text>{invoice.customer.address}</Text>
            <Text>{invoice.customer.email}</Text>
          </View>
          <View>
            <Text style={styles.bold}>From:</Text>
            <Text>Qalibrated Systems</Text>
            <Text>Qls Center </Text>
            <Text>Mombasa Rd,Nairobi, Kenya</Text>
          </View>
        </View>
        <Text style={{ fontSize: 16, fontWeight: "bold", marginTop: 5 }}>
          Quatation for {invoice.description}
        </Text>

        {/* Item List */}
        <View style={[styles.section, { marginTop: 20 }]}>
          <View style={[styles.itemRow, styles.bold]}>
            <Text style={{ width: "40%" }}>Description</Text>
            <Text style={{ width: "15%" }}>Quantity</Text>
            <Text style={{ width: "15%" }}>Unit Price</Text>
            <Text style={{ width: "15%" }}>Unit</Text>
            <Text style={{ width: "15%" }}>Total</Text>
          </View>
          {items.map((item, index) => (
            <View style={styles.itemRow} key={index}>
              <Text style={{ width: "40%" }}>{item.name}</Text>
              <Text style={{ width: "15%" }}>{item.quantity}</Text>
              <Text style={{ width: "15%" }}>KES {item.unitPrice}</Text>
              <Text style={{ width: "15%" }}>{item.unit}</Text>
              <Text style={{ width: "15%" }}>
                KES {(item.quantity * item.unitPrice).toFixed(2)}
              </Text>
            </View>
          ))}
        </View>

        {/* Total Amount */}
        <View style={styles.section}>
          {shoudShowSub && buildFooterRowItem("Subtotal", `KES ${subTotal}`)}
          {discount > 0 && buildFooterRowItem("Discount", `${discount}%`)}
          {taxRate > 0 && buildFooterRowItem("VAT", `${taxRate}%`)}

          {buildFooterRowItem("Total", `KES ${total}`)}
        </View>

        {/* Footer */}
        <Text style={styles.footer}>Thank you for your business!</Text>
      </Page>
      P
    </Document>
  );
}

export function GeneratePdf({
  items,
  invoice,
  total,
  subTotal,
  discount,
  taxRate,
  shoudShowSub,
}) {
  const [isBrowser, setIsBrowser] = useState(false);
  useEffect(() => {
    setIsBrowser(true);
  }, []);

  return (
    <>
      {isBrowser ? (
        <PDFDownloadLink
          document={
            <InvoicePDF
              discount={discount}
              invoice={invoice}
              items={items}
              shoudShowSub={shoudShowSub}
              subTotal={subTotal}
              taxRate={taxRate}
              total={total}
              key={"inv"}
            />
          }
          fileName="invoice.pdf"
        >
          {({ loading }) =>
            loading ? (
              "Generating PDF..."
            ) : (
              <Button>
                <PrinterIcon size={20} />
                <span className="ml-2">Print</span>
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

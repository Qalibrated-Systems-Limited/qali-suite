"use client";

import React from "react";
import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  PDFDownloadLink,
} from "@react-pdf/renderer";
import { Download } from "lucide-react";
import { Button } from "../../../components/ui/button";

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 10,
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
  deptTitle: {
    fontSize: 14,
    fontWeight: "bold",
    marginVertical: 10,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottom: "1px solid #000",
    paddingBottom: 5,
    marginBottom: 5,
    fontWeight: "bold",
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "1px solid #ccc",
    paddingVertical: 5,
  },
  tableCell: {
    width: "33%",
  },
});

// Fetch and organize stock dynamically from MongoDB

const StockPDF = ({ stockData }) => (
  <Document>
    <Page style={styles.page}>
      <Text style={styles.header}>
        Stock Report as of {new Date().toLocaleDateString()}
      </Text>
      {Object.entries(stockData).map(([dept, items]) => (
        <View key={dept} style={styles.section}>
          <Text style={styles.deptTitle}>{dept}</Text>
          <View style={styles.tableHeader}>
            <Text style={styles.tableCell}>SKU</Text>

            <Text style={[styles.tableCell, { width: "60%" }]}>Item Name</Text>
            <Text style={[styles.tableCell]}>Unit measure</Text>
            <Text style={styles.tableCell}>Quantity</Text>
          </View>
          {items.map((item, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={styles.tableCell}>{item.SKU || "N/A"}</Text>
              <Text style={[styles.tableCell, { width: "60%" }]}>
                {item.name}
              </Text>
              <Text style={styles.tableCell}> {item.unit ?? "-"}</Text>
              <Text style={styles.tableCell}>{item.quantity}</Text>
            </View>
          ))}
        </View>
      ))}
    </Page>
  </Document>
);

export function GenerateStockPDF({ stockData }) {
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(false);
  }, []);

  return loading ? (
    <div>Loading...</div>
  ) : (
    <PDFDownloadLink
      document={<StockPDF stockData={stockData} />}
      fileName="Stock_Report.pdf"
    >
      {({ loading }) => (
        <Button variant="outline" size="icon" disabled={loading}>
          <Download className="h-4 w-4" />
          <span className="sr-only">Download Stock PDF</span>
        </Button>
      )}
    </PDFDownloadLink>
  );
}

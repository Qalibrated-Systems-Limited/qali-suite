"use client";

import React from "react";
import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import { Download, Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { getStockPdfData } from "@/app/mongodb/actions/stock-actions";

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

// Fetch-on-click PDF export. We deliberately don't pre-fetch the
// (potentially large) product list on every /dashboard/stocks render —
// the server action is only called when the user actually wants the
// report.
export function GenerateStockPDF() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleClick = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await getStockPdfData();
      if (!res?.success) {
        setError(res?.error || "Failed to load stock data");
        setBusy(false);
        return;
      }

      // Render the PDF blob client-side and trigger a programmatic
      // download — keeps the one-click UX without any pre-fetched data.
      const blob = await pdf(<StockPDF stockData={res.data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Stock_Report.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("PDF export failed:", e);
      setError(e?.message || "PDF export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="icon"
        onClick={handleClick}
        disabled={busy}
        title="Download stock report (PDF)"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        <span className="sr-only">Download Stock PDF</span>
      </Button>
      {error && (
        <p className="text-xs text-red-500 max-w-[200px] text-right">{error}</p>
      )}
    </div>
  );
}

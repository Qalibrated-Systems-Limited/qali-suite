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
import { getStockPdfDataPg } from "@/app/db/actions/product-actions";

/**
 * THE COLUMNS HAVE TO ADD UP TO 100%.
 *
 * Every cell was `width: "33%"` with the name overridden to 60% — four columns
 * summing to 159% of the page. react-pdf lays flex children out in order and
 * does not shrink them back, so Quantity, the last column and the one the
 * whole report exists for, was pushed off the right edge of every page. The
 * report downloaded; it just could not be read.
 *
 * Fixed widths per column now, header and body sharing the same constants so
 * the two cannot drift apart again.
 */
const COL = {
  sku: "18%",
  name: "46%",
  unit: "14%",
  qty: "22%",
};

const styles = StyleSheet.create({
  page: {
    padding: 30,
    paddingBottom: 46,
    fontSize: 10,
  },
  header: {
    fontSize: 18,
    marginBottom: 4,
    textAlign: "center",
    fontWeight: "bold",
  },
  subHeader: {
    fontSize: 9,
    marginBottom: 16,
    textAlign: "center",
    color: "#555",
  },
  section: {
    marginBottom: 15,
  },
  deptTitle: {
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 6,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottom: "1px solid #000",
    paddingBottom: 4,
    marginBottom: 4,
    fontWeight: "bold",
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "1px solid #ccc",
    paddingVertical: 4,
  },
  subtotalRow: {
    flexDirection: "row",
    paddingTop: 4,
  },
  // Quantity reads as a number, so it is right-aligned — a column of
  // left-aligned figures cannot be scanned down for the odd one out.
  numeric: {
    textAlign: "right",
  },
  muted: {
    color: "#555",
  },
  pageNumber: {
    position: "absolute",
    bottom: 24,
    left: 30,
    right: 30,
    fontSize: 8,
    textAlign: "center",
    color: "#777",
  },
});

const qty = (n) => Number(n ?? 0).toLocaleString("en-KE");

function TableHeader() {
  return (
    // `fixed` repeats the header on every page the section spills onto. A
    // stock report is read a column at a time; a page of unlabelled figures
    // is not.
    <View style={styles.tableHeader} fixed>
      <Text style={{ width: COL.sku }}>SKU</Text>
      <Text style={{ width: COL.name }}>Item Name</Text>
      <Text style={{ width: COL.unit }}>Unit</Text>
      <Text style={[{ width: COL.qty }, styles.numeric]}>Quantity</Text>
    </View>
  );
}

const StockPDF = ({ stockData }) => {
  const sections = Object.entries(stockData).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const grandTotal = sections.reduce(
    (sum, [, items]) =>
      sum + items.reduce((n, item) => n + Number(item.quantity ?? 0), 0),
    0,
  );

  return (
    <Document>
      <Page style={styles.page}>
        <Text style={styles.header}>Stock Report</Text>
        <Text style={styles.subHeader}>
          As at {new Date().toLocaleString()}
        </Text>

        {sections.map(([dept, items]) => {
          const subtotal = items.reduce(
            (n, item) => n + Number(item.quantity ?? 0),
            0,
          );
          return (
            <View key={dept} style={styles.section}>
              {/* `minPresenceAhead` rather than wrapping the heading and the
                  column header in a `wrap={false}` box: that box is a single
                  unwrappable element, and a `fixed` child of one renders on
                  the page that box lands on and nowhere else — so the repeat
                  below silently did nothing. Kept apart, the header is a child
                  of the SECTION, which is what spans the pages it repeats on.
                  50pt is a heading plus a header row plus a line of items. */}
              <Text style={styles.deptTitle} minPresenceAhead={50}>
                {dept} ({items.length})
              </Text>
              <TableHeader />
              {items.map((item, index) => (
                <View key={item.SKU || index} style={styles.tableRow}>
                  <Text style={{ width: COL.sku }}>{item.SKU || "N/A"}</Text>
                  <Text style={{ width: COL.name }}>{item.name}</Text>
                  <Text style={{ width: COL.unit }}>{item.unit ?? "-"}</Text>
                  <Text style={[{ width: COL.qty }, styles.numeric]}>
                    {qty(item.quantity)}
                  </Text>
                </View>
              ))}
              <View style={styles.subtotalRow}>
                <Text style={[{ width: COL.sku }, styles.muted]}> </Text>
                <Text style={[{ width: COL.name }, styles.muted]}>
                  Subtotal — {dept}
                </Text>
                <Text style={{ width: COL.unit }}> </Text>
                <Text
                  style={[
                    { width: COL.qty },
                    styles.numeric,
                    { fontWeight: "bold" },
                  ]}
                >
                  {qty(subtotal)}
                </Text>
              </View>
            </View>
          );
        })}

        <View style={[styles.tableHeader, { borderTop: "1px solid #000" }]}>
          <Text style={{ width: COL.sku }}> </Text>
          <Text style={{ width: COL.name }}>Total units on hand</Text>
          <Text style={{ width: COL.unit }}> </Text>
          <Text style={[{ width: COL.qty }, styles.numeric]}>
            {qty(grandTotal)}
          </Text>
        </View>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
};

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
      const res = await getStockPdfDataPg();
      if (!res?.success) {
        setError(res?.error || "Failed to load stock data");
        setBusy(false);
        return;
      }

      /*
        AN EMPTY CATALOGUE IS SAID, NOT DOWNLOADED. With no active products
        the report rendered as a title and nothing else, and a one-page blank
        PDF arriving in the downloads folder reads as a broken export rather
        than an empty one — there is no way to tell them apart from the file.
      */
      if (!res.total) {
        setError("No active stock items to export yet.");
        setBusy(false);
        return;
      }

      // Render the PDF blob client-side and trigger a programmatic
      // download — keeps the one-click UX without any pre-fetched data.
      const blob = await pdf(<StockPDF stockData={res.data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Dated, because a stock report is only meaningful as at a date, and a
      // folder of files all called Stock_Report.pdf is a folder of
      // Stock_Report (3).pdf.
      a.download = `Stock Report ${new Date().toISOString().slice(0, 10)}.pdf`;
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

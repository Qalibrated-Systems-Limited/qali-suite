"use client";

import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "../styles";
import {
  DocumentHeader,
  DocumentTitle,
  PartyInfo,
  DocumentDetails,
  LineItemsTable,
  TotalsSection,
  NotesSection,
  DocumentFooter,
} from "../templates";

export function QuotePDF({ quote, logoSrc }) {
  // Build details array
  const details = [
    { label: "Quote Date", value: quote.quoteDate || quote.createdAt, isDate: true },
    { label: "Valid Until", value: quote.validUntil, isDate: true },
    { label: "Reference", value: quote.reference },
    { label: "Prepared By", value: quote.preparedBy?.name },
  ];

  // Build totals array
  const totals = [];

  // Subtotal
  totals.push({
    label: "Subtotal",
    value: quote.subtotal || calculateSubtotal(quote.items),
  });

  // Discount (if any)
  if (quote.totalDiscount && quote.totalDiscount > 0) {
    totals.push({
      label: "Discount",
      value: quote.totalDiscount,
      isCredit: true,
    });
  }

  // Tax/VAT
  if (quote.taxAmount && quote.taxAmount > 0) {
    totals.push({
      label: `VAT (${quote.taxRate || 16}%)`,
      value: quote.taxAmount,
    });
  }

  // Grand Total
  totals.push({
    label: "Quote Total",
    value: quote.total || quote.grandTotal,
    isTotal: true,
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <DocumentHeader logoSrc={logoSrc} />

        {/* Title & Status */}
        <DocumentTitle
          type="quote"
          documentNumber={quote.quoteNumber}
          status={quote.status}
        />

        {/* Customer Info */}
        <PartyInfo
          type="quote"
          party={quote.customer}
          shippingAddress={quote.deliveryAddress}
        />

        {/* Quote Details */}
        <DocumentDetails details={details} />

        {/* Line Items */}
        <LineItemsTable
          items={quote.items}
          showDiscount={true}
          currency={quote.currency || "KES"}
        />

        {/* Totals */}
        <TotalsSection totals={totals} currency={quote.currency || "KES"} />

        {/* Notes & Terms */}
        <NotesSection
          notes={quote.notes}
          terms={quote.terms || getDefaultQuoteTerms()}
        />

        {/* Footer */}
        <DocumentFooter
          pageNumber={1}
          totalPages={1}
        />
      </Page>
    </Document>
  );
}

// Helper to calculate subtotal if not provided
function calculateSubtotal(items) {
  if (!items || items.length === 0) return 0;
  return items.reduce((sum, item) => {
    const amount = item.amount || item.total || item.quantity * (item.unitPrice || item.price || 0);
    return sum + amount;
  }, 0);
}

// Default quote terms
function getDefaultQuoteTerms() {
  return `1. This quotation is valid for 30 days from the date of issue.
2. Prices are subject to change without notice after the validity period.
3. Payment terms: 50% deposit upon order confirmation, balance due before delivery.
4. Delivery timeline will be confirmed upon order placement.
5. All prices are exclusive of VAT unless otherwise stated.`;
}

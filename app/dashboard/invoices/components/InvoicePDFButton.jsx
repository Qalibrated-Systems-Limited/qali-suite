"use client";

import { PDFDownloadButton } from "@/components/pdf";
import { InvoicePDF } from "@/lib/pdf";
import { Download } from "lucide-react";

export function InvoicePDFDownloadButton({ invoice }) {
  return (
    <PDFDownloadButton
      document={<InvoicePDF data={invoice} />}
      fileName={`${invoice.invoiceNumber}.pdf`}
      variant="outline"
      size="sm"
      className="border-border hover:bg-accent"
    >
      <Download className="mr-2 h-4 w-4" />
      Download PDF
    </PDFDownloadButton>
  );
}

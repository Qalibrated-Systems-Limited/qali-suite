"use client";

import { PDFDownloadButton } from "@/components/pdf";
import { QuotePDF } from "@/lib/pdf";
import { Download } from "lucide-react";

export function QuotePDFDownloadButton({ quote, company }) {
  return (
    <PDFDownloadButton
      document={<QuotePDF quote={quote} company={company} />}
      fileName={`${quote.quoteNumber}.pdf`}
      variant="outline"
      size="sm"
    >
      <Download className="mr-2 h-4 w-4" />
      Download PDF
    </PDFDownloadButton>
  );
}

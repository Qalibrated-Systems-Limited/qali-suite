"use client";

import { Download } from "lucide-react";
import { PDFDownloadButton } from "@/components/pdf/PDFDownloadButton";
import { CreditNotePDF } from "@/lib/pdf/documents/CreditNotePDF";

export function CreditNotePDFButton({ creditNote, company }) {
  if (!creditNote || !company) {
    return null;
  }

  return (
    <PDFDownloadButton
      document={<CreditNotePDF creditNote={creditNote} company={company} />}
      fileName={`CreditNote-${creditNote.creditNoteNumber}.pdf`}
      variant="outline"
      size="sm"
    >
      <Download className="mr-2 h-4 w-4" />
      Download PDF
    </PDFDownloadButton>
  );
}

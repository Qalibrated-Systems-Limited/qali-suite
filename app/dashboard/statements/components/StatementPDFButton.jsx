"use client";

import { Download } from "lucide-react";
import { PDFDownloadButton } from "@/components/pdf/PDFDownloadButton";
import { StatementPDF } from "@/lib/pdf/documents/StatementPDF";

export function StatementPDFButton({ statement, company }) {
  if (!statement || !company) {
    return null;
  }

  const customerName = statement.customer?.name || "Customer";
  const date = new Date().toISOString().split("T")[0];

  return (
    <PDFDownloadButton
      document={<StatementPDF statement={statement} company={company} />}
      fileName={`Statement-${customerName.replace(/\s+/g, "_")}-${date}.pdf`}
      variant="default"
      size="default"
    >
      <Download className="mr-2 h-4 w-4" />
      Download PDF
    </PDFDownloadButton>
  );
}

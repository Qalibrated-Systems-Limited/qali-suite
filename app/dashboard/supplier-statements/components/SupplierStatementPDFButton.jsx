"use client";

import { Download } from "lucide-react";
import { PDFDownloadButton } from "@/components/pdf/PDFDownloadButton";
import { SupplierStatementPDF } from "@/lib/pdf/documents/SupplierStatementPDF";

export function SupplierStatementPDFButton({ statement, company }) {
  if (!statement || !company) {
    return null;
  }

  const supplierName = statement.supplier?.name || "Supplier";
  const date = new Date().toISOString().split("T")[0];

  return (
    <PDFDownloadButton
      document={<SupplierStatementPDF statement={statement} company={company} />}
      fileName={`SupplierStatement-${supplierName.replace(/\s+/g, "_")}-${date}.pdf`}
      variant="default"
      size="default"
    >
      <Download className="mr-2 h-4 w-4" />
      Download PDF
    </PDFDownloadButton>
  );
}

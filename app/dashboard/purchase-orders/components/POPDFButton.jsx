"use client";

import { PDFDownloadButton, PDFPreviewButton } from "@/components/pdf";
import { PurchaseOrderPDF } from "@/lib/pdf";
import { Download, FileText } from "lucide-react";

export function POPDFDownloadButton({ purchaseOrder, company }) {
  return (
    <PDFDownloadButton
      document={<PurchaseOrderPDF data={purchaseOrder} company={company} />}
      fileName={`${purchaseOrder.poNumber}.pdf`}
      variant="outline"
      size="sm"
    >
      <Download className="mr-2 h-4 w-4" />
      PDF
    </PDFDownloadButton>
  );
}

export function POPDFPreviewButton({ purchaseOrder, company }) {
  return (
    <PDFPreviewButton
      document={<PurchaseOrderPDF data={purchaseOrder} company={company} />}
      variant="outline"
      size="sm"
    >
      <FileText className="mr-2 h-4 w-4" />
      Preview
    </PDFPreviewButton>
  );
}

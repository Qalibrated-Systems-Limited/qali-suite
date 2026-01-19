"use client";

import { PDFDownloadButton, PDFPreviewButton } from "@/components/pdf";
import { PurchaseOrderPDF } from "@/lib/pdf";
import { Download, FileText } from "lucide-react";

export function POPDFDownloadButton({ purchaseOrder }) {
  return (
    <PDFDownloadButton
      document={<PurchaseOrderPDF data={purchaseOrder} />}
      fileName={`${purchaseOrder.poNumber}.pdf`}
      variant="outline"
      size="sm"
    >
      <Download className="mr-2 h-4 w-4" />
      PDF
    </PDFDownloadButton>
  );
}

export function POPDFPreviewButton({ purchaseOrder }) {
  return (
    <PDFPreviewButton
      document={<PurchaseOrderPDF data={purchaseOrder} />}
      variant="outline"
      size="sm"
    >
      <FileText className="mr-2 h-4 w-4" />
      Preview
    </PDFPreviewButton>
  );
}

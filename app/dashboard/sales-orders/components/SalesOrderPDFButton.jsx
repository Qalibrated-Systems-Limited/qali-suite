"use client";

import { PDFDownloadButton } from "@/components/pdf";
import { SalesOrderPDF } from "@/lib/pdf";
import { Download } from "lucide-react";

export function SalesOrderPDFButton({ order, company }) {
  return (
    <PDFDownloadButton
      document={<SalesOrderPDF order={order} company={company} />}
      fileName={`${order.orderNumber}.pdf`}
      variant="outline"
      size="sm"
    >
      <Download className="mr-2 h-4 w-4" />
      Download PDF
    </PDFDownloadButton>
  );
}

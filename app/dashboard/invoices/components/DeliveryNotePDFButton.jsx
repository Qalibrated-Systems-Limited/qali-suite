"use client";

import { PDFDownloadButton } from "@/components/pdf";
import { DeliveryNotePDF } from "@/lib/pdf";
import { FileText } from "lucide-react";

// Fallback company data
const defaultCompany = {
  name: "Company Name",
  phone: "+254 700 000 000",
  email: "info@company.co.ke",
  address: "",
  city: "",
};

/**
 * Generates a Delivery Note PDF from invoice data (strips pricing).
 * No DB lookup needed — derives the D/Note from the invoice itself.
 */
export function DeliveryNotePDFButton({ invoice, company }) {
  const companyData = company
    ? {
        ...company,
        name: company.name,
        phone: company.phone || "",
        email: company.email || "",
        address: company.fullAddress || company.address?.street || "",
        city: company.address?.city || "",
        tagline: company.tagline || "",
      }
    : defaultCompany;

  // Transform invoice data into delivery note shape
  const deliveryNote = {
    deliveryNumber: invoice.deliveryInfo?.deliveryNumber || invoice.invoiceNumber,
    date: invoice.invoiceDate,
    customer: {
      name: invoice.customer?.name || "",
      address: invoice.customer?.address || "",
      phone: invoice.customer?.phone || "",
    },
    items: invoice.items?.map((item) => ({
      name: item.name || item.productName || item.description,
      quantity: item.quantity,
      unit: item.unit || "pcs",
    })),
    notes: invoice.deliveryInfo?.deliveryAddress
      ? `Delivery address: ${invoice.deliveryInfo.deliveryAddress}`
      : null,
    createdBy: invoice.createdBy,
  };

  return (
    <PDFDownloadButton
      document={<DeliveryNotePDF deliveryNote={deliveryNote} company={companyData} />}
      fileName={`DN-${invoice.invoiceNumber}.pdf`}
      variant="outline"
      size="sm"
      className="border-border hover:bg-accent"
    >
      <FileText className="mr-2 h-4 w-4" />
      Delivery Note
    </PDFDownloadButton>
  );
}

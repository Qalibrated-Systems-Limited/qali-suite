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
 * Generates a Delivery Note PDF from stock request data (on-the-fly).
 * Transforms request items into D/Note shape — no DB lookup needed.
 */
export function RequestDeliveryNotePDFButton({ request, company }) {
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

  // Transform request data into delivery note shape
  const deliveryNote = {
    deliveryNumber: request.requestNumber,
    date: request.storekeeper?.fulfilledAt || request.updatedAt || request.createdAt,
    customer: {
      name: request.customer?.name || request.requester?.name || "",
      address: request.customer?.address || "",
      phone: request.customer?.phone || "",
    },
    reason: request.requestType?.replace(/_/g, " "),
    items: request.items?.map((item) => ({
      name: item.productName || item.name,
      quantity: item.totalFulfilled || item.approvedQuantity || item.requestedQuantity,
      unit: item.unit || "pcs",
    })),
    notes: request.notes || null,
    createdBy: request.storekeeper || request.requester,
    technician: request.requester?.department
      ? { name: `${request.requester.name} (${request.requester.department})` }
      : null,
  };

  return (
    <PDFDownloadButton
      document={<DeliveryNotePDF deliveryNote={deliveryNote} company={companyData} />}
      fileName={`DN-${request.requestNumber}.pdf`}
      variant="outline"
      size="sm"
    >
      <FileText className="mr-2 h-4 w-4" />
      Delivery Note
    </PDFDownloadButton>
  );
}

"use client";

import { PDFDownloadButton } from "@/components/pdf";
import { InvoicePDF } from "@/lib/pdf";
import { Download } from "lucide-react";

// Fallback company data (used if no company is provided)
const defaultCompany = {
  name: "Company Name",
  phone: "+254 700 000 000",
  email: "info@company.co.ke",
  address: "",
  city: "",
  taxPin: "",
  bankName: "",
  bankBranch: "",
  accountName: "",
  accountNumber: "",
  mpesaPaybill: "",
  mpesaTill: "",
};

export function InvoicePDFDownloadButton({ invoice, company }) {
  // Map Company model fields to what InvoicePDF expects
  const companyData = company
    ? {
        ...company,
        name: company.name,
        phone: company.phone || "",
        email: company.email || "",
        address: company.fullAddress || company.address?.street || "",
        city: company.address?.city || "",
        taxPin: company.taxPin || "",
        bankName: company.bankName || "",
        bankBranch: company.bankBranch || "",
        accountName: company.accountName || "",
        accountNumber: company.accountNumber || "",
        mpesaPaybill: company.mpesaPaybill || "",
        mpesaTill: company.mpesaTill || "",
      }
    : defaultCompany;

  return (
    <PDFDownloadButton
      document={<InvoicePDF invoice={invoice} company={companyData} />}
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

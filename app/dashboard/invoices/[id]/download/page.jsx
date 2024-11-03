import React from "react";
import ReactPdf, { Document, Page, Text, View } from "@react-pdf/renderer";
import { InvoicePDF } from "../download";
const invoiceData = {
  date: "31-10-2024",
  invoiceNumber: "123456",
  clientName: "John Doe",
  clientAddress: "123 Client St.",
  companyName: "Your Company",
  companyAddress: "456 Company Ave.",
  items: [
    { description: "Product 1", quantity: 2, unitPrice: 50 },
    { description: "Service A", quantity: 1, unitPrice: 100 },
  ],
  total: 200,
};

function page() {
  return <InvoicePDF invoiceData={invoiceData} />;
}

export default page;

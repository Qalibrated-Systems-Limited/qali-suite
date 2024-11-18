"use client";

import { FileDownIcon } from "lucide-react";

import * as XLSX from "xlsx";

export function DownloadReport({ summaryResult, startDate, endDate }) {
  const transformedData = summaryResult.map((res) => {
    return {
      "INVOICE NUMBER": res.invoiceNumber,
      DATE: res.date,

      CUSTOMER: res.customer,
      AMOUNT: res.totalAmount,
      STATUS: res.status,
    };
  });

  function downloadExcel() {
    const worksheet = XLSX.utils.json_to_sheet(transformedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, ` reports`);

    XLSX.writeFile(
      workbook,
      `Invoices reports from ${startDate}-${endDate}.xlsx`
    );
  }

  return <FileDownIcon onClick={downloadExcel} size={30} />;
}

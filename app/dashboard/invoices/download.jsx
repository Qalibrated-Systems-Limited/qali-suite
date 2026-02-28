"use client";

import { FileDownIcon } from "lucide-react";
import ExcelJS from "exceljs";

export function DownloadReport({ summaryResult, startDate, endDate }) {
  async function downloadExcel() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("reports");

    worksheet.columns = [
      { header: "INVOICE NUMBER", key: "invoiceNumber", width: 20 },
      { header: "DATE", key: "date", width: 15 },
      { header: "CUSTOMER", key: "customer", width: 25 },
      { header: "AMOUNT", key: "amount", width: 15 },
      { header: "STATUS", key: "status", width: 12 },
    ];

    summaryResult.forEach((res) => {
      worksheet.addRow({
        invoiceNumber: res.invoiceNumber,
        date: res.date,
        customer: res.customer,
        amount: res.totalAmount,
        status: res.status,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Invoices reports from ${startDate}-${endDate}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return <FileDownIcon onClick={downloadExcel} size={30} />;
}

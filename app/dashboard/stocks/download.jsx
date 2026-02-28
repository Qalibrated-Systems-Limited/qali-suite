"use client";

import { FileDownIcon } from "lucide-react";
import ExcelJS from "exceljs";

export function DownloadReport({ summaryResult, startDate, endDate }) {
  async function downloadExcel() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("reports");

    worksheet.columns = [
      { header: "TRAN ID", key: "tranId", width: 15 },
      { header: "TIMESTAMP", key: "timestamp", width: 20 },
      { header: "COMMODITY", key: "commodity", width: 20 },
      { header: "CUSTOMER", key: "customer", width: 20 },
      { header: "VEHICLE", key: "vehicle", width: 15 },
      { header: "FIRST WEIGHT(Kg)", key: "firstWeight", width: 18 },
      { header: "SECOND WEIGHT(Kg)", key: "secondWeight", width: 18 },
      { header: "NET WEIGHT(KG)", key: "netWeight", width: 18 },
    ];

    summaryResult.forEach((res) => {
      worksheet.addRow({
        tranId: res._id,
        timestamp: res.date,
        commodity: res.commodity,
        customer: res.customer,
        vehicle: res.vehRegNo,
        firstWeight: res.firstWeight ?? "",
        secondWeight: res.secondWeight ?? "",
        netWeight: res.netWeight ?? "",
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Weights reports from ${startDate}-${endDate}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return <FileDownIcon onClick={downloadExcel} size={30} />;
}

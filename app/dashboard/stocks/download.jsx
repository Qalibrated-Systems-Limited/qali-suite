"use client";

import { FileDownIcon } from "lucide-react";

import * as XLSX from "xlsx";

export function DownloadReport({ summaryResult, startDate, endDate }) {
  const transformedData = summaryResult.map((res) => {
    return {
      "TRAN ID": res._id,
      TIMESTAMP: res.date,
      COMMODITY: res.commodity,
      CUSTOMER: res.customer,
      VEHICLE: res.vehRegNo,

      "FIRST WEIGHT(Kg)": res.firstWeight && res.firstWeight.toString(),
      "SECOND WEIGHT(Kg)": res.secondWeight && res.secondWeight.toString(),
      "NET WEIGHT(KG)": res.netWeight && res.netWeight.toString(),
    };
  });

  function downloadExcel() {
    const worksheet = XLSX.utils.json_to_sheet(transformedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, ` reports`);

    XLSX.writeFile(
      workbook,
      `Weights reports from ${startDate}-${endDate}.xlsx`
    );
  }

  return <FileDownIcon onClick={downloadExcel} size={30} />;
}

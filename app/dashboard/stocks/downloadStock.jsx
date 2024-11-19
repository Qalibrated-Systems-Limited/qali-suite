"use client";

import { format } from "date-fns/format";
import { FileDownIcon } from "lucide-react";

import * as XLSX from "xlsx";

export function DownloadStock({ summaryResult }) {
  const transformedData = summaryResult.map((res) => {
    return {
      SKU: res.SKU,
      NAME: res.name,
      "PRICE PER UNIT": res.price.toString(),
      QUANTITY: res.stock.toString(),
    };
  });

  function downloadExcel() {
    const worksheet = XLSX.utils.json_to_sheet(transformedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, ` reports`);

    XLSX.writeFile(
      workbook,
      `Stock as at ${format(new Date(), "dd-MM-yyyy")}.xlsx`
    );
  }

  return <FileDownIcon onClick={downloadExcel} size={30} />;
}

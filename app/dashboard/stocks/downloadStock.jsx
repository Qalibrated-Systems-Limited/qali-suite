"use client";

import { format } from "date-fns/format";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as XLSX from "xlsx";

export function DownloadStock({ summaryResult }) {
  const transformedData = summaryResult.map((res) => {
    return {
      SKU: res.SKU,
      NAME: res.name,
      "PRICE PER UNIT": (res.pricing?.sellingPrice ?? 0).toString(),
      QUANTITY: (res.inventory?.quantityOnHand ?? 0).toString(),
    };
  });

  function downloadExcel() {
    const worksheet = XLSX.utils.json_to_sheet(transformedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "reports");

    XLSX.writeFile(
      workbook,
      `Stock as at ${format(new Date(), "dd-MM-yyyy")}.xlsx`
    );
  }

  return (
    <Button variant="outline" size="icon" onClick={downloadExcel}>
      <Download className="h-4 w-4" />
      <span className="sr-only">Download Stock Excel</span>
    </Button>
  );
}

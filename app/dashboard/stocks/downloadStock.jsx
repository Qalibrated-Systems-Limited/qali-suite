"use client";

import { format } from "date-fns/format";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import ExcelJS from "exceljs";

export function DownloadStock({ summaryResult }) {
  async function downloadExcel() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("reports");

    worksheet.columns = [
      { header: "SKU", key: "sku", width: 15 },
      { header: "NAME", key: "name", width: 30 },
      { header: "PRICE PER UNIT", key: "price", width: 15 },
      { header: "QUANTITY", key: "quantity", width: 12 },
    ];

    summaryResult.forEach((res) => {
      worksheet.addRow({
        sku: res.SKU,
        name: res.name,
        price: res.pricing?.sellingPrice ?? 0,
        quantity: res.inventory?.quantityOnHand ?? 0,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Stock as at ${format(new Date(), "dd-MM-yyyy")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="icon" onClick={downloadExcel}>
      <Download className="h-4 w-4" />
      <span className="sr-only">Download Stock Excel</span>
    </Button>
  );
}

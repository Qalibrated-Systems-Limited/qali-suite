"use client";

import { Printer, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PayslipActions({ entryId }) {
  const pdfUrl = `/api/hr/my-payslip/${entryId}`;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
        onClick={() => {
          const w = window.open(pdfUrl, "_blank");
          if (w) {
            w.addEventListener("load", () => w.print());
          }
        }}
      >
        <Printer className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Print</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
        asChild
      >
        <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Download PDF</span>
        </a>
      </Button>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { PDFViewer } from "@react-pdf/renderer";
import { Loader2 } from "lucide-react";
import InvoicePDF from "./Download";

export default function InvoicePrintPage({ invoice }) {
  const [isBrowser, setIsBrowser] = useState(false);

  useEffect(() => {
    setIsBrowser(true);
  }, []);

  if (!isBrowser) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
          <p className="text-sm text-muted-foreground">
            Loading invoice preview...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 p-4">
      <div className="container mx-auto">
        {/* Header */}
        <div className="bg-card border border-border rounded-lg p-4 mb-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">
                Invoice Preview
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {invoice.invoiceNumber} • {invoice.customer.name}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-black font-medium rounded-md transition-colors text-sm"
              >
                Print
              </button>
              <button
                onClick={() => window.close()}
                className="px-4 py-2 bg-card border border-border hover:bg-accent text-foreground rounded-md transition-colors text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>

        {/* PDF Viewer */}
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <PDFViewer
            width="100%"
            height={800}
            style={{
              border: "none",
            }}
            showToolbar={true}
          >
            <InvoicePDF invoice={invoice} />
          </PDFViewer>
        </div>
      </div>
    </div>
  );
}

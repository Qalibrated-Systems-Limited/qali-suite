"use client";

import { useState } from "react";
import { PDFViewer } from "@react-pdf/renderer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Download, X, Loader2 } from "lucide-react";
import InvoicePDF from "./Download";

export function InvoicePrintDialog({ invoice, open, onOpenChange }) {
  const [isLoading, setIsLoading] = useState(true);

  const handleLoad = () => {
    setIsLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] h-[95vh] bg-card border-border p-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-500/10 rounded-lg">
                <Printer className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <DialogTitle className="text-foreground text-lg font-semibold">
                  Invoice Preview
                </DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {invoice?.invoiceNumber} • {invoice?.customer.name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-border hover:bg-accent"
                onClick={() => window.print()}
              >
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* PDF Viewer */}
        <div className="flex-1 relative overflow-hidden bg-muted/20">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
                <p className="text-sm text-muted-foreground">
                  Loading invoice preview...
                </p>
              </div>
            </div>
          )}

          <PDFViewer
            width="100%"
            height="100%"
            style={{
              border: "none",
              backgroundColor: "transparent",
            }}
            showToolbar={true}
            onLoadSuccess={handleLoad}
          >
            <InvoicePDF invoice={invoice} />
          </PDFViewer>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-muted/30 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Use the toolbar above to download, print, or navigate the document
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border"
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// PRINT BUTTON COMPONENT
// ============================================
export function InvoicePrintButton({
  invoice,
  variant = "outline",
  size = "sm",
}) {
  const [showDialog, setShowDialog] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setShowDialog(true)}
        className="border-border hover:bg-accent"
      >
        <Printer className="w-4 h-4 mr-2" />
        Print/Preview
      </Button>

      <InvoicePrintDialog
        invoice={invoice}
        open={showDialog}
        onOpenChange={setShowDialog}
      />
    </>
  );
}

// ============================================
// ICON-ONLY PRINT BUTTON (For table actions)
// ============================================
export function InvoicePrintIconButton({ invoice }) {
  const [showDialog, setShowDialog] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowDialog(true)}
        className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent transition-colors"
        title="Print/Preview Invoice"
      >
        <Printer className="w-4 h-4 text-muted-foreground hover:text-foreground" />
      </button>

      <InvoicePrintDialog
        invoice={invoice}
        open={showDialog}
        onOpenChange={setShowDialog}
      />
    </>
  );
}

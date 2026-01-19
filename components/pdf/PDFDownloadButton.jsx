"use client";

import { useState } from "react";
import { pdf } from "@react-pdf/renderer";
import { Button } from "@/components/ui/button";
import { Download, Loader2, FileText } from "lucide-react";

/**
 * Generic PDF Download Button
 *
 * Usage:
 * <PDFDownloadButton
 *   document={<InvoicePDF invoice={invoice} />}
 *   fileName={`Invoice-${invoice.invoiceNumber}.pdf`}
 * />
 */
export function PDFDownloadButton({
  document,
  fileName = "document.pdf",
  variant = "outline",
  size = "sm",
  className = "",
  children,
  disabled = false,
}) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownload = async () => {
    if (isGenerating || disabled) return;

    setIsGenerating(true);

    try {
      // Generate PDF blob
      const blob = await pdf(document).toBlob();

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = fileName;

      // Trigger download
      window.document.body.appendChild(link);
      link.click();

      // Cleanup
      window.document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error generating PDF:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleDownload}
      disabled={isGenerating || disabled}
    >
      {isGenerating ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Generating...
        </>
      ) : (
        children || (
          <>
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </>
        )
      )}
    </Button>
  );
}

/**
 * PDF Preview Button - Opens in new tab
 */
export function PDFPreviewButton({
  document,
  variant = "ghost",
  size = "sm",
  className = "",
  children,
  disabled = false,
}) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handlePreview = async () => {
    if (isGenerating || disabled) return;

    setIsGenerating(true);

    try {
      const blob = await pdf(document).toBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (error) {
      console.error("Error generating PDF:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handlePreview}
      disabled={isGenerating || disabled}
    >
      {isGenerating ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading...
        </>
      ) : (
        children || (
          <>
            <FileText className="mr-2 h-4 w-4" />
            Preview
          </>
        )
      )}
    </Button>
  );
}

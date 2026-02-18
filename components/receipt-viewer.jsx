"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Download, File, X, Eye } from "lucide-react";

function isPdf(r) {
  return (
    r?.mimeType === "application/pdf" ||
    r?.url?.toLowerCase().endsWith(".pdf")
  );
}

function getPdfEmbedUrl(url) {
  return `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`;
}

/**
 * ReceiptViewer — inline horizontal scroll gallery with expand-to-preview
 *
 * Props:
 *  - receipts: Array of { url, viewUrl, filename, mimeType }
 *    where viewUrl is the resolved URL (signed for PDFs)
 */
export function ReceiptViewer({ receipts = [] }) {
  const scrollRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const active = activeIndex >= 0 ? receipts[activeIndex] : null;

  if (!receipts.length) return null;

  return (
    <div className="space-y-3">
      {/* Thumbnail strip — swipeable horizontal scroll */}
      <div
        ref={scrollRef}
        className="flex gap-2 sm:gap-3 overflow-x-auto scroll-smooth pb-2 snap-x -mx-1 px-1"
        style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
      >
        {receipts.map((receipt, idx) => {
          const selected = idx === activeIndex;
          return (
            <button
              key={idx}
              type="button"
              data-receipt
              onClick={() => setActiveIndex(selected ? -1 : idx)}
              className={`shrink-0 w-20 sm:w-32 border-2 rounded-lg overflow-hidden text-left transition-all cursor-pointer ${
                selected
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border hover:border-primary/40"
              }`}
            >
              {isPdf(receipt) ? (
                <div className="aspect-square bg-muted flex flex-col items-center justify-center gap-1 p-2">
                  <File className="w-6 h-6 sm:w-8 sm:h-8 text-red-500" />
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground text-center truncate w-full">
                    PDF
                  </span>
                </div>
              ) : (
                <div className="aspect-square relative bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={receipt.url}
                    alt={receipt.filename}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="px-1.5 py-1 sm:px-2 sm:py-1.5 border-t">
                <p className="text-[9px] sm:text-[11px] text-muted-foreground truncate">
                  {receipt.filename}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Expanded preview */}
      {active && (
        <div className="border rounded-lg overflow-hidden bg-muted/20 animate-in slide-in-from-top-2 fade-in duration-200">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
            <Eye className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-xs sm:text-sm font-medium truncate flex-1">
              {active.filename}
            </span>
            <a
              href={active.viewUrl}
              download={active.filename}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              title="Download"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download</span>
            </a>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setActiveIndex(-1)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Preview content */}
          {isPdf(active) ? (
            <iframe
              src={getPdfEmbedUrl(active.viewUrl)}
              title={active.filename}
              className="w-full h-80 sm:h-125 lg:h-150 border-0"
            />
          ) : (
            <div className="flex items-center justify-center bg-black/5 dark:bg-white/5 overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={active.viewUrl || active.url}
                alt={active.filename}
                className="w-full h-auto max-h-80 sm:max-h-125 lg:max-h-150 object-contain"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

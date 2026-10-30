"use client";

import { useEffect, useState } from "react";
import { Eye, Download, X } from "lucide-react";

/**
 * Opens a PDF in a viewer over the page, with a download button beside it.
 *
 * `href` is a PDF route that answers inline by default and as an attachment
 * with `?download=1` — the convention the technical, calibration and
 * inspection routes follow. The browser's own viewer renders it, so there is
 * no PDF library in the client bundle.
 */
export default function PdfPreviewButton({ href, title = "Preview", className, label = "Preview" }) {
  const [open, setOpen] = useState(false);
  const downloadHref = `${href}${href.includes("?") ? "&" : "?"}download=1`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
      >
        <Eye size={14} />
        {label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(13,34,56,.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(960px, 100%)",
              height: "min(92vh, 1200px)",
              background: "var(--card)",
              borderRadius: 10,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 24px 60px rgba(0,0,0,.35)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                color: "var(--foreground)",
              }}
            >
              <strong style={{ fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {title}
              </strong>
              <a
                href={downloadHref}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--foreground)" }}
              >
                <Download size={15} /> Download
              </a>
              <button
                type="button"
                aria-label="Close preview"
                onClick={() => setOpen(false)}
                style={{ background: "none", border: 0, color: "var(--foreground)", cursor: "pointer", padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>
            <iframe title={title} src={href} style={{ flex: 1, border: 0, width: "100%", background: "#525659" }} />
          </div>
        </div>
      )}
    </>
  );
}

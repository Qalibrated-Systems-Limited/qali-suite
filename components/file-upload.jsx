"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, X, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FILE_ICONS = {
  "application/pdf": FileText,
  default: ImageIcon,
};

function getFileIcon(mimeType) {
  return FILE_ICONS[mimeType] || FILE_ICONS.default;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUpload({
  value = [],
  onChange,
  folder = "receipts",
  maxFiles = 5,
  disabled = false,
  className,
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const uploadFile = useCallback(
    async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", folder);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      return res.json();
    },
    [folder]
  );

  const handleFiles = useCallback(
    async (files) => {
      if (disabled || uploading) return;

      const remaining = maxFiles - value.length;
      const toUpload = Array.from(files)
        .filter((file) => {
          // Skip duplicates — match by filename + size
          const isDuplicate = value.some(
            (existing) =>
              existing.filename === file.name && existing.size === file.size
          );
          return !isDuplicate;
        })
        .slice(0, remaining);

      if (toUpload.length === 0) return;

      setUploading(true);
      try {
        const results = await Promise.all(toUpload.map(uploadFile));
        onChange([...value, ...results]);
      } catch (error) {
        console.error("Upload error:", error);
        alert(error.message || "Upload failed");
      } finally {
        setUploading(false);
        // Reset input so the same file can be re-selected if removed
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [disabled, uploading, maxFiles, value, onChange, uploadFile]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleRemove = useCallback(
    (index) => {
      onChange(value.filter((_, i) => i !== index));
    },
    [value, onChange]
  );

  const canAddMore = value.length < maxFiles && !disabled;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Drop zone */}
      {canAddMore && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
            dragOver
              ? "border-yellow-500 bg-yellow-500/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50",
            uploading && "pointer-events-none opacity-60"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={disabled || uploading}
          />
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Uploading...
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <Upload className="w-6 h-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drop files here or{" "}
                <span className="text-foreground font-medium">browse</span>
              </p>
              <p className="text-xs text-muted-foreground">
                JPEG, PNG, PDF up to 10MB ({value.length}/{maxFiles})
              </p>
            </div>
          )}
        </div>
      )}

      {/* File list */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((file, index) => {
            const Icon = getFileIcon(file.mimeType);
            const isImage = file.mimeType?.startsWith("image/");

            return (
              <div
                key={file.url || index}
                className="flex items-center gap-3 p-2 rounded-lg border bg-muted/30 group"
              >
                {/* Thumbnail or icon */}
                {isImage ? (
                  <img
                    src={file.url}
                    alt={file.filename}
                    className="w-10 h-10 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {file.filename}
                  </p>
                  {file.size && (
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  )}
                </div>

                {/* Remove button */}
                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    onClick={() => handleRemove(index)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

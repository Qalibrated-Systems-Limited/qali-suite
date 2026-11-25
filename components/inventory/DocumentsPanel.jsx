"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Paperclip, Upload, Loader2, FileText, Image as ImageIcon, FileSpreadsheet, Trash2, ExternalLink } from "lucide-react";
import { INVENTORY_DOC_ENTITIES, docCategoryLabel } from "@/lib/inventory/documents";
import {
  listInventoryDocuments,
  attachInventoryDocuments,
  removeInventoryDocument,
} from "@/app/db/actions/inventory-document-actions";

/**
 * Documents attached to an inventory record: list, preview, attach, remove.
 * `readOnly` shows the list only (used where people review, not edit).
 */

const ACCEPT = "image/*,application/pdf,.doc,.docx,.xls,.xlsx";
const size = (b) => (!b ? "" : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const iconFor = (mime) => (mime?.startsWith("image/") ? ImageIcon : /sheet|excel/.test(mime || "") ? FileSpreadsheet : FileText);

export default function DocumentsPanel({ entityType, entityId, readOnly = false, title = "Documents", compact = false }) {
  const cats = INVENTORY_DOC_ENTITIES[entityType]?.categories ?? [["other", "Other"]];
  const [docs, setDocs] = useState(null);
  const [category, setCategory] = useState(cats[0][0]);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, start] = useTransition();
  const input = useRef(null);

  const load = useCallback(async () => setDocs(await listInventoryDocuments(entityType, entityId)), [entityType, entityId]);
  useEffect(() => {
    load();
  }, [load]);

  const upload = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const f of Array.from(files).slice(0, 10)) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("folder", "inventory");
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `Could not upload ${f.name}`);
        uploaded.push({ name: f.name, url: body.url, publicId: body.publicId, mimeType: f.type, size: f.size, category, note });
      }
      const r = await attachInventoryDocuments(entityType, entityId, uploaded);
      if (!r.success) throw new Error(r.error);
      toast.success(r.message);
      setNote("");
      await load();
    } catch (e) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  if (readOnly && docs && docs.length === 0) return null;

  return (
    <section className={`rounded-xl border border-border bg-card ${compact ? "" : "print:break-inside-avoid"}`}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="h-4 w-4 text-muted-foreground" /> {title}
          {docs && <span className="text-xs font-normal text-muted-foreground">· {docs.length}</span>}
        </h2>
      </header>

      {!readOnly && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            upload(e.dataTransfer.files);
          }}
          className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center"
        >
          <select
            aria-label="Document type"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
          >
            {cats.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input
            aria-label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
          />
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => upload(e.target.files)} />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={uploading}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Uploading…" : "Attach files"}
          </button>
        </div>
      )}

      {docs === null ? (
        <p className="flex items-center gap-1.5 p-4 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </p>
      ) : docs.length === 0 ? (
        <p className="p-4 text-xs text-muted-foreground">
          Nothing attached yet. Photos, PDFs, Word and Excel files up to 10 MB — drag them here or use Attach files.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {docs.map((d) => {
            const Icon = iconFor(d.mimeType);
            const isImage = d.mimeType?.startsWith("image/");
            return (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2">
                {isImage ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.url} alt="" className="h-10 w-10 rounded object-cover ring-1 ring-border" />
                  </a>
                ) : (
                  <Icon className="h-8 w-8 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <a href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-sm font-medium hover:underline">
                    <span className="truncate">{d.name}</span> <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                  </a>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {docCategoryLabel(entityType, d.category)}
                    {d.size ? ` · ${size(d.size)}` : ""} · {d.uploadedByName} ·{" "}
                    {new Date(d.uploadedAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                    {d.note ? ` · ${d.note}` : ""}
                  </p>
                </div>
                {!readOnly && d.canRemove && (
                  <button
                    type="button"
                    aria-label={`Remove ${d.name}`}
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Remove ${d.name}?`)) return;
                      start(async () => {
                        const r = await removeInventoryDocument(d.id);
                        r.success ? toast.success(r.message) : toast.error(r.error);
                        await load();
                      });
                    }}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

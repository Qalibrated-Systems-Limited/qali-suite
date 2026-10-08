"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FileUpload } from "@/components/file-upload";
import { FileText, Image as ImageIcon, ExternalLink, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  addProjectDocument,
  deleteProjectDocument,
} from "@/app/db/actions/project-document-actions";

export const DOC_CATEGORIES = [
  { value: "contract", label: "Contract" },
  { value: "boq", label: "Bill of Quantities" },
  { value: "budget", label: "Budget" },
  { value: "drawing", label: "Drawing" },
  { value: "certificate", label: "Certificate" },
  { value: "variation", label: "Variation" },
  { value: "permit", label: "Permit" },
  { value: "insurance", label: "Insurance" },
  { value: "correspondence", label: "Correspondence" },
  { value: "other", label: "Other" },
];
const LABEL = Object.fromEntries(DOC_CATEGORIES.map((c) => [c.value, c.label]));

const fmtSize = (b) => {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "";

/**
 * The project's documents — upload (reusing the shared FileUpload → /api/upload
 * → Cloudinary path) and the list of what's on file. `fixedCategory` embeds the
 * panel inside another screen (the contract screen passes "contract"), so it
 * only shows and files that kind.
 */
export default function ProjectDocuments({
  projectId,
  documents = [],
  canManage = false,
  fixedCategory = null,
  title = "Documents",
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState(fixedCategory || "other");
  const [docTitle, setDocTitle] = useState("");

  const onUploaded = (files) => {
    const file = files[files.length - 1];
    if (!file?.url) return;
    startTransition(async () => {
      const res = await addProjectDocument(projectId, {
        category: fixedCategory || category,
        title: docTitle,
        file,
      });
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Uploaded.");
        setDocTitle("");
        router.refresh();
      }
    });
  };

  const remove = (id) =>
    startTransition(async () => {
      const res = await deleteProjectDocument(id);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Removed.");
        router.refresh();
      }
    });

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {canManage && (
        <div className="mb-4 space-y-3 rounded-lg border border-border p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!fixedCategory && (
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  {DOC_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Title (optional)</Label>
              <Input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="e.g. Signed contract — Rev B"
              />
            </div>
          </div>
          {/* maxFiles=1 so each pick is saved immediately with its type/title. */}
          <FileUpload value={[]} onChange={onUploaded} folder={`projects/${projectId}`} maxFiles={1} disabled={pending} />
        </div>
      )}

      {documents.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No documents uploaded yet.
        </p>
      ) : (
        <ul className="divide-y">
          {documents.map((d) => {
            const isImage = (d.mimeType || "").startsWith("image/");
            const Icon = isImage ? ImageIcon : FileText;
            return (
              <li key={d.id} className="flex items-center gap-3 py-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {d.title || d.fileName || "Document"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {LABEL[d.category] || d.category} · {fmtSize(d.sizeBytes)} ·{" "}
                    {d.uploadedByName} · {fmtDate(d.createdAt)}
                  </p>
                </div>
                {!fixedCategory && (
                  <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
                    {LABEL[d.category] || d.category}
                  </Badge>
                )}
                <Button asChild size="icon" variant="ghost" className="shrink-0">
                  <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" title="Open">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
                {canManage && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => remove(d.id)}
                    disabled={pending}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

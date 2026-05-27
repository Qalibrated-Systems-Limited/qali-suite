"use client";

import { useActionState, useTransition, useRef, useState } from "react";
import { FileText, Upload, Trash2, Loader2, AlertCircle, CheckCircle2, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadEmployeeDocument, deleteEmployeeDocument } from "@/app/mongodb/actions/hr-employee-actions";

const uploadInitial = { success: false, error: null };

const DOC_TYPES = [
  { value: "contract", label: "Employment Contract" },
  { value: "national_id", label: "National ID Copy" },
  { value: "kcse", label: "KCSE Certificate" },
  { value: "diploma", label: "Diploma / Higher Diploma" },
  { value: "degree", label: "University Degree" },
  { value: "masters", label: "Masters / Postgraduate" },
  { value: "phd", label: "PhD / Doctorate" },
  { value: "professional", label: "Professional Certificate" },
  { value: "membership", label: "Professional Membership (EBK, CPA, LSK…)" },
  { value: "medical", label: "Medical Certificate" },
  { value: "tax_form", label: "Tax Form (P9)" },
  { value: "other", label: "Other" },
];

function DocUploadForm({ profileId, onClose }) {
  const [state, formAction, isPending] = useActionState(uploadEmployeeDocument, uploadInitial);
  const formRef = useRef(null);

  if (state.success && formRef.current) formRef.current.reset();

  return (
    <form ref={formRef} action={formAction} className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
      <input type="hidden" name="profileId" value={profileId} />
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Upload Document</h3>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {state.error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-500/5 p-2 text-xs text-red-700 dark:border-red-900 dark:text-red-400">
          <AlertCircle className="h-3 w-3" /> {state.error}
        </div>
      )}
      {state.success && (
        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" /> Document uploaded successfully.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Document Type</label>
          <select
            name="docType"
            required
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">— Select type —</option>
            {DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Document Name (optional)</label>
          <input
            name="docName"
            type="text"
            placeholder="e.g. Employment Contract 2024"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">File (PDF, image — max 10MB)</label>
        <input
          name="file"
          type="file"
          required
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          className="w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {isPending ? "Uploading..." : "Upload"}
        </Button>
      </div>
    </form>
  );
}

function DocRow({ profileId, doc, canDelete }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm(`Delete "${doc.name || doc.docType}"?`)) return;
    startTransition(async () => {
      await deleteEmployeeDocument(profileId, doc._id);
    });
  }

  const typeLabel = DOC_TYPES.find((t) => t.value === doc.docType)?.label || doc.docType;

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{doc.name || typeLabel}</p>
          <p className="text-xs text-muted-foreground">
            {typeLabel}
            {doc.uploadedAt && ` · ${new Date(doc.uploadedAt).toLocaleDateString("en-KE")}`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {doc.url && (
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="View document"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            title="Delete"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

export default function EmployeeDocuments({ profileId, documents = [], userRole }) {
  const canUpload = ["SuperAdmin", "Admin", "HR", "Manager"].includes(userRole);
  const canDelete = ["SuperAdmin", "Admin", "HR"].includes(userRole);
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      {/* Documents list */}
      <div className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            Documents {documents.length > 0 && <span className="ml-1 text-muted-foreground font-normal">({documents.length})</span>}
          </h3>
          {canUpload && !showForm && (
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
              <Upload className="h-3.5 w-3.5" />
              <span className="ml-1.5">Upload</span>
            </Button>
          )}
        </div>

        {documents.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No documents uploaded yet.</p>
        ) : (
          <div className="divide-y divide-border px-4">
            {documents.map((doc) => (
              <DocRow key={doc._id} profileId={profileId} doc={doc} canDelete={canDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Upload form — shown on demand */}
      {canUpload && showForm && (
        <DocUploadForm profileId={profileId} onClose={() => setShowForm(false)} />
      )}
    </div>
  );
}

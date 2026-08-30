"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  FileEdit,
  Plus,
  Loader2,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import {
  createInstruction,
  updateInstruction,
  setInstructionStatus,
  deleteInstruction,
} from "@/app/db/actions/project-log-actions";
import { toast } from "sonner";

const TYPE_LABELS = {
  instruction: "Instruction",
  ncr: "NCR",
  vo: "Variation Order",
  rfi_response: "RFI Response",
};

const TYPE_BADGE = {
  instruction: "bg-blue-500/10 text-blue-600",
  ncr: "bg-red-500/10 text-red-600",
  vo: "bg-amber-500/10 text-amber-600",
  rfi_response: "bg-violet-500/10 text-violet-600",
};

const STATUS_BADGE = {
  pending: "bg-amber-500/10 text-amber-600",
  complied: "bg-emerald-500/10 text-emerald-600",
  disputed: "bg-red-500/10 text-red-600",
};

const EMPTY_FORM = {
  type: "instruction",
  clauseReference: "",
  location: "",
  issuedDate: new Date().toISOString().slice(0, 10),
  issuedByName: "",
  description: "",
  estimatedCost: "",
};

/**
 * Engineer's Instructions log — 0075.
 *
 * `canManage` logs and edits records; `canSignOff` is the narrower group
 * that may record the compliance decision (Complied / Disputed) — mirrors
 * the write/approve split used across the rest of the app (e.g. bills).
 */
export default function InstructionsLog({
  projectId,
  instructions = [],
  summary,
  canManage = false,
  canSignOff = false,
}) {
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [respondingId, setRespondingId] = useState(null);
  const [responseNotes, setResponseNotes] = useState("");

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditingId(null);
  }

  function startEditing(ei) {
    setForm({
      type: ei.type,
      clauseReference: ei.clauseReference || "",
      location: ei.location || "",
      issuedDate: ei.issuedDate,
      issuedByName: ei.issuedByName || "",
      description: ei.description || "",
      estimatedCost: ei.estimatedCost || "",
    });
    setEditingId(ei.id);
    setShowForm(true);
  }

  function buildFormData() {
    const fd = new FormData();
    fd.set("projectId", projectId);
    Object.entries(form).forEach(([k, v]) => fd.set(k, v ?? ""));
    return fd;
  }

  function handleSave() {
    if (!form.description.trim()) {
      toast.error("A description is required");
      return;
    }
    if (!form.issuedByName.trim()) {
      toast.error("Who issued this is required");
      return;
    }
    startTransition(async () => {
      const fd = buildFormData();
      const res = editingId
        ? await updateInstruction(editingId, null, fd)
        : await createInstruction(null, fd);
      if (res?.success) {
        toast.success(res.message);
        resetForm();
      } else {
        toast.error(Object.values(res?.errors ?? {}).flat()[0] || "Failed to save");
      }
    });
  }

  function handleRespond(ei, status) {
    startTransition(async () => {
      const res = await setInstructionStatus(ei.id, projectId, {
        status,
        responseNotes: respondingId === ei.id ? responseNotes : undefined,
      });
      if (res.success) {
        toast.success(res.message);
        setRespondingId(null);
        setResponseNotes("");
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleDelete(ei) {
    startTransition(async () => {
      const res = await deleteInstruction(ei.id, projectId);
      if (res.success) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FileEdit className="h-5 w-5 text-muted-foreground shrink-0" />
          <h3 className="font-semibold">Engineer's Instructions</h3>
        </div>
        {canManage && !showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Record EI</span>
          </Button>
        )}
      </div>

      {summary && summary.total > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-xs">{summary.total} total</Badge>
          <Badge className={`text-xs ${STATUS_BADGE.pending}`}>{summary.pending} pending</Badge>
          <Badge className={`text-xs ${STATUS_BADGE.complied}`}>{summary.complied} complied</Badge>
          {summary.disputed > 0 && (
            <Badge className={`text-xs ${STATUS_BADGE.disputed}`}>{summary.disputed} disputed</Badge>
          )}
          {summary.ncrs > 0 && (
            <Badge className={`text-xs ${TYPE_BADGE.ncr}`}>{summary.ncrs} NCR</Badge>
          )}
        </div>
      )}

      {showForm && canManage && (
        <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <Select value={form.type} onValueChange={(v) => set("type", v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Date issued *</label>
              <Input
                type="date"
                className="h-9"
                value={form.issuedDate}
                onChange={(e) => set("issuedDate", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Clause reference</label>
              <Input
                placeholder="e.g. GCC 3.3"
                className="h-9"
                value={form.clauseReference}
                onChange={(e) => set("clauseReference", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Location / chainage</label>
              <Input
                placeholder="e.g. KM 3+400"
                className="h-9"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Issued by *</label>
              <Input
                placeholder="e.g. Resident Engineer"
                className="h-9"
                value={form.issuedByName}
                onChange={(e) => set("issuedByName", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Est. cost (KES)</label>
              <Input
                type="number"
                inputMode="decimal"
                className="h-9"
                value={form.estimatedCost}
                onChange={(e) => set("estimatedCost", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description *</label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What was instructed, and why"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={isPending} onClick={handleSave}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? "Save changes" : "Log instruction"}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      )}

      {instructions.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No instructions logged yet for this project.
        </p>
      )}

      <div className="divide-y">
        {instructions.map((ei) => (
          <div key={ei.id} className="py-3 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">{ei.instructionNumber}</span>
                  <Badge className={`text-xs ${TYPE_BADGE[ei.type] || TYPE_BADGE.instruction}`}>
                    {TYPE_LABELS[ei.type] || ei.type}
                  </Badge>
                  <Badge className={`text-xs ${STATUS_BADGE[ei.status] || STATUS_BADGE.pending}`}>
                    {ei.status === "pending" ? "Pending" : ei.status === "complied" ? "Complied" : "Disputed"}
                  </Badge>
                  {ei.clauseReference && (
                    <span className="font-mono text-[11px] text-muted-foreground">{ei.clauseReference}</span>
                  )}
                  {ei.location && (
                    <span className="text-xs text-muted-foreground">· {ei.location}</span>
                  )}
                </div>
                <p className="text-sm">{ei.description}</p>
                <p className="text-xs text-muted-foreground">
                  {ei.issuedDate} · issued by {ei.issuedByName}
                  {ei.estimatedCost > 0 && ` · est. KES ${Number(ei.estimatedCost).toLocaleString()}`}
                </p>
                {ei.status !== "pending" && ei.respondedByName && (
                  <p className="text-xs text-muted-foreground">
                    {ei.status === "complied" ? "Complied" : "Disputed"} by {ei.respondedByName}
                    {ei.responseNotes && ` — ${ei.responseNotes}`}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {canSignOff && ei.status === "pending" && respondingId !== ei.id && (
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => setRespondingId(ei.id)}>
                    Respond
                  </Button>
                )}
                {canSignOff && ei.status !== "pending" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => handleRespond(ei, "pending")}
                    title="Reopen"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
                {canManage && (
                  <Button size="sm" variant="ghost" disabled={isPending} onClick={() => startEditing(ei)} title="Edit">
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                {canManage && ei.status === "pending" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => handleDelete(ei)}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>

            {respondingId === ei.id && (
              <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                <Textarea
                  rows={2}
                  placeholder="Response notes (optional)"
                  value={responseNotes}
                  onChange={(e) => setResponseNotes(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={isPending} onClick={() => handleRespond(ei, "complied")}>
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Mark Complied
                  </Button>
                  <Button size="sm" variant="destructive" disabled={isPending} onClick={() => handleRespond(ei, "disputed")}>
                    <XCircle className="h-4 w-4 mr-1" />
                    Mark Disputed
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setRespondingId(null); setResponseNotes(""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {ei.type === "ncr" && ei.status === "pending" && (
              <div className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                Non-conformance — outstanding
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  BookOpen,
  Plus,
  Loader2,
  Pencil,
  Trash2,
  ShieldCheck,
  CloudSun,
  Users,
  AlertTriangle,
  FileX,
} from "lucide-react";
import {
  createDiaryEntry,
  updateDiaryEntry,
  signDiaryEntry,
  deleteDiaryEntry,
} from "@/app/db/actions/project-log-actions";
import { toast } from "sonner";

const EMPTY_FORM = {
  diaryDate: new Date().toISOString().slice(0, 10),
  weather: "",
  location: "",
  activities: "",
  plant: "",
  manpowerCount: "",
  incidentCount: "0",
  incidentNotes: "",
  loggedByName: "",
};

/**
 * Contractor's Site Diary — 0075.
 *
 * `canManage` logs and edits entries; `canSignOff` is the narrower group
 * standing in for the Resident Engineer's countersignature (there is no RE
 * role in this system — see `PROJECT_LOG_SIGNOFF_ROLES`).
 */
export default function DiaryLog({
  projectId,
  entries = [],
  canManage = false,
  canSignOff = false,
}) {
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const unsigned = entries.filter((e) => e.status === "submitted").length;

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditingId(null);
  }

  function startEditing(entry) {
    setForm({
      diaryDate: entry.diaryDate,
      weather: entry.weather || "",
      location: entry.location || "",
      activities: entry.activities || "",
      plant: entry.plant || "",
      manpowerCount: String(entry.manpowerCount ?? ""),
      incidentCount: String(entry.incidentCount ?? "0"),
      incidentNotes: entry.incidentNotes || "",
      loggedByName: entry.loggedByName || "",
    });
    setEditingId(entry.id);
    setShowForm(true);
  }

  function buildFormData() {
    const fd = new FormData();
    fd.set("projectId", projectId);
    Object.entries(form).forEach(([k, v]) => fd.set(k, v ?? ""));
    return fd;
  }

  function handleSave() {
    if (!form.activities.trim()) {
      toast.error("Activities carried out are required");
      return;
    }
    if (!form.loggedByName.trim()) {
      toast.error("Logged by is required");
      return;
    }
    startTransition(async () => {
      const fd = buildFormData();
      const res = editingId
        ? await updateDiaryEntry(editingId, null, fd)
        : await createDiaryEntry(null, fd);
      if (res?.success) {
        toast.success(res.message);
        resetForm();
      } else {
        toast.error(Object.values(res?.errors ?? {}).flat()[0] || "Failed to save");
      }
    });
  }

  function handleSign(entry) {
    startTransition(async () => {
      const res = await signDiaryEntry(entry.id, projectId);
      if (res.success) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  function handleDelete(entry) {
    startTransition(async () => {
      const res = await deleteDiaryEntry(entry.id, projectId);
      if (res.success) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="h-5 w-5 text-muted-foreground shrink-0" />
          <h3 className="font-semibold">Site Diary</h3>
        </div>
        {canManage && !showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">New entry</span>
          </Button>
        )}
      </div>

      {unsigned > 0 && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <FileX className="h-4 w-4" />
          <AlertDescription className="text-sm">
            {unsigned} {unsigned === 1 ? "entry" : "entries"} awaiting countersignature.
          </AlertDescription>
        </Alert>
      )}

      {showForm && canManage && (
        <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Date *</label>
              <Input
                type="date"
                className="h-9"
                value={form.diaryDate}
                onChange={(e) => set("diaryDate", e.target.value)}
                disabled={!!editingId}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Weather</label>
              <Input
                placeholder="e.g. Sunny"
                className="h-9"
                value={form.weather}
                onChange={(e) => set("weather", e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Chainage / location *</label>
              <Input
                placeholder="e.g. KM 0+000 – 2+500 (Front 1)"
                className="h-9"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Plant deployed</label>
              <Input
                placeholder="e.g. Grader×2, Dozer×2, Tipper×6"
                className="h-9"
                value={form.plant}
                onChange={(e) => set("plant", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Logged by *</label>
              <Input
                className="h-9"
                value={form.loggedByName}
                onChange={(e) => set("loggedByName", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Manpower on site</label>
              <Input
                type="number"
                inputMode="numeric"
                className="h-9"
                value={form.manpowerCount}
                onChange={(e) => set("manpowerCount", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Incidents</label>
              <Input
                type="number"
                inputMode="numeric"
                className="h-9"
                value={form.incidentCount}
                onChange={(e) => set("incidentCount", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Activities carried out *</label>
            <Textarea
              rows={3}
              value={form.activities}
              onChange={(e) => set("activities", e.target.value)}
            />
          </div>
          {Number(form.incidentCount) > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Incident notes</label>
              <Textarea
                rows={2}
                value={form.incidentNotes}
                onChange={(e) => set("incidentNotes", e.target.value)}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={isPending} onClick={handleSave}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? "Save changes" : "Log entry"}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      )}

      {entries.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No diary entries yet for this project.
        </p>
      )}

      <div className="divide-y">
        {entries.map((entry) => (
          <div key={entry.id} className="py-3 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">{entry.entryNumber}</span>
                  <span className="text-sm font-medium">{entry.diaryDate}</span>
                  <Badge
                    className={`text-xs ${
                      entry.status === "countersigned"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-amber-500/10 text-amber-600"
                    }`}
                  >
                    {entry.status === "countersigned" ? "Countersigned" : "Awaiting sign-off"}
                  </Badge>
                  {entry.weather && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <CloudSun className="h-3.5 w-3.5" /> {entry.weather}
                    </span>
                  )}
                  {entry.manpowerCount > 0 && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> {entry.manpowerCount}
                    </span>
                  )}
                  {entry.incidentCount > 0 && (
                    <span className="text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" /> {entry.incidentCount} incident
                      {entry.incidentCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {entry.location && (
                  <p className="text-xs text-muted-foreground">{entry.location}</p>
                )}
                <p className="text-sm">{entry.activities}</p>
                {entry.plant && (
                  <p className="text-xs text-muted-foreground">Plant: {entry.plant}</p>
                )}
                <p className="text-xs text-muted-foreground">Logged by {entry.loggedByName}</p>
                {entry.status === "countersigned" && entry.countersignedByName && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                    Countersigned by {entry.countersignedByName}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {canSignOff && entry.status === "submitted" && (
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => handleSign(entry)}>
                    <ShieldCheck className="h-4 w-4 mr-1" />
                    Countersign
                  </Button>
                )}
                {canManage && entry.status !== "countersigned" && (
                  <>
                    <Button size="sm" variant="ghost" disabled={isPending} onClick={() => startEditing(entry)} title="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleDelete(entry)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  Sparkles,
  Calendar,
  AlertCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  createLeaveType,
  updateLeaveType,
  deleteLeaveType,
  seedLeaveTypes,
} from "@/app/mongodb/actions/leave-type-actions";

const GENDER_OPTIONS = [
  { value: "all", label: "All employees" },
  { value: "female", label: "Female only" },
  { value: "male", label: "Male only" },
];

function emptyForm() {
  return {
    code: "",
    name: "",
    defaultEntitlement: "0",
    maxCarryOver: "0",
    paidLeave: true,
    requiresDocument: false,
    applicableGender: "all",
    sortOrder: "0",
    description: "",
    isActive: true,
  };
}

export function LeaveTypesPage({ leaveTypes, loadError }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState("");
  const [dialog, setDialog] = useState(null); // null | "create" | { type: "edit", row } | { type: "delete", row }
  const [form, setForm] = useState(emptyForm());
  const [fieldErrors, setFieldErrors] = useState({});

  const hasTypes = leaveTypes.length > 0;
  const sorted = useMemo(
    () => [...leaveTypes].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [leaveTypes],
  );

  const openCreate = () => {
    setForm(emptyForm());
    setFieldErrors({});
    setActionError("");
    setDialog("create");
  };

  const openEdit = (row) => {
    setForm({
      code: row.code,
      name: row.name,
      defaultEntitlement: String(row.defaultEntitlement ?? 0),
      maxCarryOver: String(row.maxCarryOver ?? 0),
      paidLeave: row.paidLeave !== false,
      requiresDocument: !!row.requiresDocument,
      applicableGender: row.applicableGender || "all",
      sortOrder: String(row.sortOrder ?? 0),
      description: row.description || "",
      isActive: row.isActive !== false,
    });
    setFieldErrors({});
    setActionError("");
    setDialog({ type: "edit", row });
  };

  const closeDialog = () => {
    setDialog(null);
    setFieldErrors({});
    setActionError("");
  };

  const submitForm = () => {
    setActionError("");
    setFieldErrors({});
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => {
      fd.append(k, typeof v === "boolean" ? String(v) : v);
    });

    startTransition(async () => {
      let res;
      if (dialog === "create") {
        res = await createLeaveType(undefined, fd);
      } else if (dialog?.type === "edit") {
        fd.append("leaveTypeId", dialog.row._id);
        res = await updateLeaveType(undefined, fd);
      }
      if (res?.success) {
        closeDialog();
        router.refresh();
      } else {
        setActionError(res?.error || "Action failed");
        if (res?.fieldErrors) setFieldErrors(res.fieldErrors);
      }
    });
  };

  const runDelete = () => {
    if (dialog?.type !== "delete") return;
    setActionError("");
    startTransition(async () => {
      const res = await deleteLeaveType(dialog.row._id);
      if (res?.success) {
        closeDialog();
        router.refresh();
      } else {
        setActionError(res?.error || "Delete failed");
      }
    });
  };

  const runSeed = () => {
    setActionError("");
    startTransition(async () => {
      const res = await seedLeaveTypes();
      if (res?.success) router.refresh();
      else setActionError(res?.error || "Seed failed");
    });
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">
            Leave Types
          </h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Configure leave categories, default entitlements, carry-over, and
            policy rules.
          </p>
        </div>
        <div className="flex gap-2">
          {!hasTypes && (
            <Button
              variant="outline"
              onClick={runSeed}
              disabled={isPending}
              title="Seed Kenya-typical defaults: Annual, Sick, Maternity, Paternity, Compassionate, Unpaid"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Seed defaults
            </Button>
          )}
          <Button onClick={openCreate} disabled={isPending}>
            <Plus className="mr-2 h-4 w-4" />
            Add Leave Type
          </Button>
        </div>
      </header>

      {loadError && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}
      {actionError && !dialog && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {!hasTypes ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
          <Calendar className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">No leave types configured yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Seed defaults or add types manually to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-right">Days/year</th>
                <th className="px-4 py-3 text-right">Carry-over</th>
                <th className="px-4 py-3 text-left">Paid</th>
                <th className="px-4 py-3 text-left">Doc req.</th>
                <th className="px-4 py-3 text-left">Gender</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row._id}
                  className="border-t border-border hover:bg-muted/30"
                >
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {row.code}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.defaultEntitlement ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.maxCarryOver ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    {row.paidLeave ? "Yes" : "No"}
                  </td>
                  <td className="px-4 py-3">
                    {row.requiresDocument ? "Yes" : "—"}
                  </td>
                  <td className="px-4 py-3 capitalize">
                    {row.applicableGender || "all"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.isActive !== false
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {row.isActive !== false ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(row)}
                        title="Edit"
                        disabled={isPending}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setDialog({ type: "delete", row })
                        }
                        title="Delete"
                        disabled={isPending}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit dialog — shared form */}
      <Dialog
        open={dialog === "create" || dialog?.type === "edit"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {dialog === "create" ? "Add Leave Type" : "Edit Leave Type"}
            </DialogTitle>
            <DialogDescription>
              Defines a leave category employees can request and the default
              policy that governs it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="code">Code *</Label>
                <Input
                  id="code"
                  value={form.code}
                  disabled={dialog?.type === "edit"}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      code: e.target.value.toLowerCase(),
                    }))
                  }
                  placeholder="annual"
                />
                {fieldErrors.code && (
                  <p className="text-xs text-red-500">{fieldErrors.code}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="Annual Leave"
                />
                {fieldErrors.name && (
                  <p className="text-xs text-red-500">{fieldErrors.name}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="defaultEntitlement">Default days / year</Label>
                <Input
                  id="defaultEntitlement"
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.defaultEntitlement}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      defaultEntitlement: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="maxCarryOver">Max carry-over (days)</Label>
                <Input
                  id="maxCarryOver"
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.maxCarryOver}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maxCarryOver: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="applicableGender">Applicable to</Label>
                <Select
                  value={form.applicableGender}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, applicableGender: v }))
                  }
                >
                  <SelectTrigger id="applicableGender">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sortOrder">Display order</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  min="0"
                  step="1"
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sortOrder: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="When this leave applies, supporting docs, etc."
              />
            </div>

            <div className="flex flex-col gap-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="paidLeave" className="cursor-pointer">
                    Paid leave
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Affects payroll calculation
                  </p>
                </div>
                <Switch
                  id="paidLeave"
                  checked={form.paidLeave}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, paidLeave: v }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="requiresDocument" className="cursor-pointer">
                    Document required
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    e.g., medical certificate for sick leave
                  </p>
                </div>
                <Switch
                  id="requiresDocument"
                  checked={form.requiresDocument}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, requiresDocument: v }))
                  }
                />
              </div>
              {dialog?.type === "edit" && (
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="isActive" className="cursor-pointer">
                      Active
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Hide from new requests when disabled
                    </p>
                  </div>
                  <Switch
                    id="isActive"
                    checked={form.isActive}
                    onCheckedChange={(v) =>
                      setForm((f) => ({ ...f, isActive: v }))
                    }
                  />
                </div>
              )}
            </div>

            {actionError && (
              <p className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-sm text-red-700 dark:text-red-300">
                {actionError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={isPending}>
              {isPending
                ? "Saving…"
                : dialog === "create"
                ? "Create"
                : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={dialog?.type === "delete"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete leave type?</DialogTitle>
            <DialogDescription>
              {dialog?.type === "delete" && (
                <>
                  <span className="font-semibold">{dialog.row.name}</span> will
                  be removed (or marked inactive if it&apos;s in use). This
                  doesn&apos;t affect leave requests already approved under it.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <p className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-sm text-red-700 dark:text-red-300">
              {actionError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={runDelete}
              disabled={isPending}
            >
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

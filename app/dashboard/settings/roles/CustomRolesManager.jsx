"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ShieldPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  createCustomRoleAction,
  updateCustomRoleAction,
  deleteCustomRoleAction,
} from "@/app/db/actions/role-actions";

/**
 * Manage the tenant's custom roles.
 *
 * A custom role is a name plus a canonical BASE role it is authorised as — the
 * base is what every permission gate actually checks (see 0120). So the one
 * decision that matters here is the base: it decides what the role can do.
 */
export default function CustomRolesManager({ roles, baseRoles, canManage }) {
  const [dialog, setDialog] = useState(null); // null | {mode:"create"} | {mode:"edit", role}
  const [pending, startTransition] = useTransition();

  const closeAndRefresh = () => setDialog(null);

  const onDelete = (role) => {
    if (
      !confirm(
        `Delete the "${role.name}" role? People must be reassigned first.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await deleteCustomRoleAction(role.id);
      if (res?.error) toast.error(res.error);
      else toast.success(`Deleted "${role.name}".`);
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldPlus className="h-4 w-4" /> Custom roles
        </h2>
        {canManage && (
          <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
            <Plus className="mr-1.5 h-4 w-4" /> New role
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Company-defined roles. Each is authorised as its <b>base role</b> — a
        role can never do more than the base it is built on — so you can give a
        title of your own (e.g. Quality Manager) without changing what the app
        allows.
      </p>

      {roles.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No custom roles yet.
          {canManage && " Use “New role” to add one."}
        </Card>
      ) : (
        <Card className="divide-y">
          {roles.map((role) => (
            <div
              key={role.id}
              className="flex items-start justify-between gap-3 p-3 sm:p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{role.name}</span>
                  <Badge variant="secondary" className="text-[11px]">
                    acts as {role.baseRole}
                  </Badge>
                  {role.isSystem && (
                    <Badge variant="outline" className="text-[11px]">
                      built-in
                    </Badge>
                  )}
                </div>
                {role.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {role.description}
                  </p>
                )}
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setDialog({ mode: "edit", role })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={pending}
                    onClick={() => onDelete(role)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {dialog && (
        <RoleDialog
          mode={dialog.mode}
          role={dialog.role}
          baseRoles={baseRoles}
          onDone={closeAndRefresh}
          onCancel={() => setDialog(null)}
        />
      )}
    </section>
  );
}

function RoleDialog({ mode, role, baseRoles, onDone, onCancel }) {
  const [name, setName] = useState(role?.name ?? "");
  const [baseRole, setBaseRole] = useState(role?.baseRole ?? "Employee");
  const [description, setDescription] = useState(role?.description ?? "");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const fd = new FormData();
    if (mode === "edit") fd.set("id", role.id);
    fd.set("name", name);
    fd.set("baseRole", baseRole);
    fd.set("description", description);
    startTransition(async () => {
      const action =
        mode === "edit" ? updateCustomRoleAction : createCustomRoleAction;
      const res = await action(null, fd);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Saved.");
        onDone();
      }
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit role" : "New custom role"}
          </DialogTitle>
          <DialogDescription>
            The base role decides what this role can do everywhere in the app.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block text-sm">Role name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Quality Manager"
            />
          </div>
          <div>
            <Label className="mb-1 block text-sm">Authorised as (base role)</Label>
            <select
              value={baseRole}
              onChange={(e) => setBaseRole(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {baseRoles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.value}
                  {r.description ? ` — ${r.description}` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              This role gets exactly the permissions of {baseRole}.
            </p>
          </div>
          <div>
            <Label className="mb-1 block text-sm">Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this role is for"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {mode === "edit" ? "Save changes" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

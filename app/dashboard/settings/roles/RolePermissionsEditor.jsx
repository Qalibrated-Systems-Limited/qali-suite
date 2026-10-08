"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Save, RotateCcw, Power, Check } from "lucide-react";
import { toast } from "sonner";
import {
  setRolePermissionsAction,
  resetRolePermissionsAction,
  setCustomRoleActiveAction,
} from "@/app/db/actions/role-actions";

/**
 * Assign permissions to roles, and switch custom roles on and off.
 *
 * Each role's tick-boxes start from what it effectively holds (its overrides, or
 * its base's code defaults). Saving writes the exact set chosen — after which it
 * is authoritative — and Reset drops the overrides so it follows its base again.
 */
export default function RolePermissionsEditor({ modules, roles, canManage }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeRole, setActiveRole] = useState(roles[0]?.name ?? "");

  // Working checkbox state per role, seeded from the server's effective keys.
  const [draft, setDraft] = useState(() => {
    const m = {};
    for (const r of roles) m[r.name] = new Set(r.keys);
    return m;
  });

  const role = roles.find((r) => r.name === activeRole) ?? roles[0];
  const original = useMemo(
    () => new Set(role ? roles.find((r) => r.name === role.name)?.keys : []),
    [role, roles],
  );
  const current = useMemo(
    () => draft[role?.name] ?? new Set(),
    [draft, role],
  );
  const dirty = useMemo(() => {
    if (current.size !== original.size) return true;
    for (const k of current) if (!original.has(k)) return true;
    return false;
  }, [current, original]);

  if (!role) return null;

  const toggle = (key) => {
    if (!canManage) return;
    setDraft((prev) => {
      const next = new Set(prev[role.name]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [role.name]: next };
    });
  };

  const save = () => {
    startTransition(async () => {
      const res = await setRolePermissionsAction(role.name, [...current]);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res.message ?? "Saved.");
        router.refresh();
      }
    });
  };

  const reset = () => {
    if (!confirm(`Reset "${role.name}" to its base defaults?`)) return;
    startTransition(async () => {
      const res = await resetRolePermissionsAction(role.name);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res.message ?? "Reset.");
        router.refresh();
      }
    });
  };

  const toggleActive = () => {
    startTransition(async () => {
      const res = await setCustomRoleActiveAction(role.id, !role.isActive);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(role.isActive ? "Role deactivated." : "Role reactivated.");
        router.refresh();
      }
    });
  };

  return (
    <div className="grid gap-4 md:grid-cols-[200px_1fr]">
      {/* Role list */}
      <Card className="h-max p-1.5">
        <div className="max-h-[28rem] space-y-0.5 overflow-y-auto">
          {roles.map((r) => (
            <button
              key={r.name}
              onClick={() => setActiveRole(r.name)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm ${
                r.name === activeRole
                  ? "bg-primary/10 font-medium text-primary"
                  : "hover:bg-muted"
              }`}
            >
              <span className="truncate">{r.name}</span>
              {r.isCustom && !r.isActive && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  off
                </Badge>
              )}
            </button>
          ))}
        </div>
      </Card>

      {/* Permission checklist for the selected role */}
      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 font-semibold">
              {role.name}
              {role.isCustom ? (
                <Badge variant="secondary" className="text-[11px]">
                  acts as {role.baseRole}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[11px]">
                  built-in
                </Badge>
              )}
              <Badge variant="outline" className="text-[11px]">
                {role.explicit ? "custom set" : "base defaults"}
              </Badge>
            </h3>
            <p className="text-xs text-muted-foreground">
              {current.size} of{" "}
              {modules.reduce((n, m) => n + m.permissions.length, 0)} permissions
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {role.isCustom && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleActive}
                  disabled={pending}
                >
                  <Power className="mr-1.5 h-4 w-4" />
                  {role.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={reset}
                disabled={pending || !role.explicit}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Reset
              </Button>
              <Button size="sm" onClick={save} disabled={pending || !dirty}>
                {pending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" />
                )}
                Save
              </Button>
            </div>
          )}
        </div>

        {role.name === "SuperAdmin" && (
          <p className="mb-3 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            SuperAdmin always holds every permission; changes here don&apos;t
            restrict it.
          </p>
        )}

        <div className="space-y-4">
          {modules.map((group) => (
            <div key={group.module}>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.module}
              </h4>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {group.permissions.map((p) => {
                  const on = current.has(p.key);
                  return (
                    <label
                      key={p.key}
                      className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${
                        on ? "border-primary/40 bg-primary/5" : "border-border"
                      } ${canManage ? "" : "cursor-default opacity-90"}`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40"
                        }`}
                      >
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        disabled={!canManage}
                        onChange={() => toggle(p.key)}
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{p.label}</span>
                        {p.description && (
                          <span className="block text-xs text-muted-foreground">
                            {p.description}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

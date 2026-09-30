import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ShieldCheck, Users, KeyRound, AlertTriangle } from "lucide-react";
import { canSeeSettingsNav, roleAllowed } from "@/lib/permissions";
import { ADMIN_ROLES } from "@/lib/utils/role-gates";
import {
  getCustomRoles,
  getRolePermissionMatrix,
} from "@/app/db/actions/role-actions";
import { ROLES as CANONICAL_ROLES } from "@/lib/permission-catalog";
import CustomRolesManager from "./CustomRolesManager";
import RolePermissionsEditor from "./RolePermissionsEditor";
import {
  roleSummary,
  NON_CANONICAL_ROLES,
  PERMISSION_GROUPS,
  NAV_PERMISSIONS,
} from "@/lib/permission-catalog";

export const metadata = {
  title: "Roles & Permissions | Settings",
  description: "Every role and the permissions it holds, read from the code that enforces them.",
};

export default async function RolesPermissionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeSettingsNav(session.user.role)) redirect("/dashboard");

  const roles = roleSummary();
  const totalPermissions = PERMISSION_GROUPS.length + NAV_PERMISSIONS.length;
  const canManage = roleAllowed(session.user.role, ADMIN_ROLES);
  const [customRoles, matrix] = await Promise.all([
    getCustomRoles(),
    getRolePermissionMatrix(),
  ]);

  return (
    <div className="max-w-5xl space-y-6 sm:p-2 lg:p-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link
          href="/dashboard/settings"
          className="mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-2xl">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Roles &amp; Permissions
          </h1>
          <p className="text-sm text-muted-foreground">
            {roles.length} roles, {totalPermissions} permissions. Read live from
            the gates the server enforces — this is the system of record, not a
            copy that can drift.
          </p>
        </div>
      </div>

      {/* Audit finding: roles referenced but not assignable */}
      {NON_CANONICAL_ROLES.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="space-y-1.5 text-sm">
              <p className="font-semibold text-amber-700 dark:text-amber-400">
                {NON_CANONICAL_ROLES.length} role
                {NON_CANONICAL_ROLES.length === 1 ? "" : "s"} referenced by a
                permission but not assignable to a user
              </p>
              <p className="text-muted-foreground">
                These names appear in a permission gate but are not in the
                canonical role list, so no user can hold them and the grant is
                dormant. Add the role, or map the gate to an existing one.
              </p>
              <ul className="mt-1 space-y-1">
                {NON_CANONICAL_ROLES.map((r) => (
                  <li key={r.role}>
                    <span className="font-medium">{r.role}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      — used by {r.gates.join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* Roles */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Users className="h-4 w-4" /> Roles
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            <Card key={role.value} className="p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{role.value}</h3>
                <Badge variant="secondary" className="shrink-0">
                  {role.count}/{role.total}
                </Badge>
              </div>
              {role.description && (
                <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                  {role.description}
                </p>
              )}
            </Card>
          ))}
        </div>
      </section>

      {/* Custom roles — create/edit/delete, assignable to users */}
      <CustomRolesManager
        roles={customRoles}
        baseRoles={CANONICAL_ROLES}
        canManage={canManage}
      />

      {/* Permissions — interactive: assign to each role */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <KeyRound className="h-4 w-4" /> Permissions
        </h2>
        <p className="text-sm text-muted-foreground">
          Pick a role, then tick the permissions it holds. A role stays on its
          base defaults until you save it; saving makes the ticked set
          authoritative. {canManage ? "" : "You can view but not change these."}
        </p>
        <RolePermissionsEditor
          modules={matrix.modules}
          roles={matrix.roles}
          canManage={canManage}
        />
      </section>

      <p className="pt-2 text-xs text-muted-foreground">
        SuperAdmin always holds every permission. Nav and module-access
        permissions take effect immediately; in-code write gates back-stop by the
        role&apos;s base.
      </p>
    </div>
  );
}

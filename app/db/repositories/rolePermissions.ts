import { eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { rolePermissions, customRoles } from "../schema/customRoles";
import { defaultKeysForRole, isPermissionKey } from "@/lib/permission-catalog";
import { userRoles } from "@/lib/utils";

const CANONICAL = new Set(userRoles);

/**
 * A marker row written on every save, so a role that has been configured down to
 * ZERO permissions is distinguishable from one never edited (which uses code
 * defaults). It is filtered out of every returned key set.
 */
const CONFIGURED = "__configured__";

/** The permission keys explicitly stored for a role (may be empty). */
export async function explicitKeys(tx: Tx, roleName: string): Promise<string[]> {
  const rows = await tx
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(sql`lower(${rolePermissions.roleName}) = lower(${roleName})`);
  return rows.map((r) => r.key).filter((k) => k !== CONFIGURED);
}

/** True once a role has been edited (has explicit rows). */
export async function hasExplicit(tx: Tx, roleName: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: rolePermissions.id })
    .from(rolePermissions)
    .where(sql`lower(${rolePermissions.roleName}) = lower(${roleName})`)
    .limit(1);
  return Boolean(row);
}

/** The canonical base a role is authorised as (a custom role's base, or itself). */
export async function baseForRole(tx: Tx, roleName: string): Promise<string> {
  if (CANONICAL.has(roleName)) return roleName;
  const [row] = await tx
    .select({ baseRole: customRoles.baseRole })
    .from(customRoles)
    .where(sql`lower(${customRoles.name}) = lower(${roleName})`)
    .limit(1);
  return row?.baseRole ?? roleName;
}

/**
 * The effective permission keys for a role: its explicit set once configured,
 * otherwise the code defaults for its base role.
 */
export async function effectiveKeys(
  tx: Tx,
  roleName: string,
): Promise<Set<string>> {
  if (await hasExplicit(tx, roleName)) {
    return new Set(await explicitKeys(tx, roleName));
  }
  const base = await baseForRole(tx, roleName);
  return new Set(defaultKeysForRole(base) as string[]);
}

/**
 * Replace a role's permission set. Only real keys are stored, plus a marker row
 * so an empty set still counts as "configured" rather than falling back to
 * defaults. A renamed or removed permission cannot leave a dangling grant.
 */
export async function setRoleKeys(
  tx: Tx,
  companyId: string,
  roleName: string,
  keys: string[],
) {
  const clean = [...new Set(keys.filter((k) => isPermissionKey(k)))];
  await tx
    .delete(rolePermissions)
    .where(sql`lower(${rolePermissions.roleName}) = lower(${roleName})`);
  await tx.insert(rolePermissions).values(
    [CONFIGURED, ...clean].map((permissionKey) => ({
      companyId,
      roleName,
      permissionKey,
    })),
  );
}

/** Clear a role's overrides so it returns to its base's code defaults. */
export async function resetRoleKeys(tx: Tx, roleName: string) {
  await tx
    .delete(rolePermissions)
    .where(sql`lower(${rolePermissions.roleName}) = lower(${roleName})`);
}

/** The raw role a user holds in a company (custom name or canonical), unresolved. */
export async function assignedRole(
  tx: Tx,
  userId: string,
  companyId: string,
): Promise<string | null> {
  const [row] = (await tx.execute(sql`
    SELECT COALESCE(a.role, u.role) AS role
      FROM users u
      LEFT JOIN user_company_access a
        ON a.user_id = u.id AND a.status = 'active' AND a.company_id = ${companyId}::uuid
     WHERE u.id = ${userId}
  `)) as unknown as Array<{ role: string }>;
  return row ? String(row.role) : null;
}

/** Deactivate / reactivate a custom role. */
export async function setCustomRoleActive(tx: Tx, id: string, active: boolean) {
  await tx
    .update(customRoles)
    .set({ isActive: active, updatedAt: new Date() })
    .where(eq(customRoles.id, id));
}

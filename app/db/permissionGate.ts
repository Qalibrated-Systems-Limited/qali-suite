import * as gates from "@/lib/utils/role-gates";
import { roleAllowed } from "@/lib/permissions";
import type { Tx } from "./client";
import {
  assignedRole,
  explicitKeys,
  hasExplicit,
} from "./repositories/rolePermissions";

/**
 * WHAT ROLES & PERMISSIONS SAVES IS WHAT THE SERVER ENFORCES.
 *
 * The Roles & Permissions page stored each role's ticked permissions, but no
 * check ever read them: every action still asked only the role arrays in
 * lib/utils/role-gates.js. Ticking or unticking a box changed nothing anyone
 * could do. This closes that gap at the one seam every action passes through,
 * `withAuthorizedTenant`.
 *
 * A permission key is a gate's export name (FINANCE_WRITE_ROLES and so on).
 * Call sites pass the gate's role array, often as a copy (`[...GATE]`), so the
 * array is recognised by its CONTENT, not its identity. Several exports share
 * one list (CLAIM_PAY_ROLES = FINANCE_WRITE_ROLES); holding any of them passes.
 * An inline list that matches no gate has no permission to look up, and stays
 * a plain role check.
 */

const signature = (roles: readonly string[]) =>
  [...new Set(roles)].sort().join("|");

const GATE_KEYS: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [name, value] of Object.entries(gates)) {
    if (!Array.isArray(value)) continue;
    const sig = signature(value as string[]);
    map.set(sig, [...(map.get(sig) ?? []), name]);
  }
  return map;
})();

/** The permission keys a role array stands for (empty when it is no gate). */
export function gateKeysFor(allowedRoles: readonly string[]): string[] {
  return GATE_KEYS.get(signature(allowedRoles)) ?? [];
}

/**
 * May this user pass this gate, given the company's saved role permissions?
 *
 * Returns `null` when nothing saved applies (the gate is no catalog permission,
 * or the role was never edited): the caller then uses the code defaults, which
 * is exactly what an unedited role has always meant.
 *
 * `role` is the role the user acts as (a custom role already resolved to its
 * base). A custom role can never do more than its base: it passes only where
 * the base passes AND its own saved set (if it has one) holds the permission.
 */
export async function permittedBySavedRoles(
  tx: Tx,
  userId: string,
  companyId: string,
  role: string,
  allowedRoles: readonly string[],
): Promise<boolean | null> {
  if (role === "SuperAdmin") return true;
  const keys = gateKeysFor(allowedRoles);
  if (!keys.length) return null;

  const holds = async (roleName: string) => {
    const saved = new Set(await explicitKeys(tx, roleName));
    return keys.some((k) => saved.has(k));
  };

  const baseEdited = await hasExplicit(tx, role);
  const assigned = (await assignedRole(tx, userId, companyId)) ?? role;
  const isCustom = assigned.toLowerCase() !== role.toLowerCase();
  const customEdited = isCustom && (await hasExplicit(tx, assigned));

  if (!baseEdited && !customEdited) return null;

  const baseOk = baseEdited
    ? await holds(role)
    : roleAllowed(role, allowedRoles as string[]);
  if (!customEdited) return baseOk;
  return baseOk && (await holds(assigned));
}

import * as gates from "@/lib/utils/role-gates";

/**
 * SAVED ROLE PERMISSIONS, FOR THE CHECKS THAT DECIDE WHAT A PERSON SEES.
 *
 * The server's data gate already obeys the Roles & Permissions page
 * (app/db/permissionGate.ts). What the person SEES — sidebar entries, module
 * menus, the buttons and pages that ask `hasRole()` or `can()` — still read
 * the role lists in code, so a permission taken away on that page left the
 * link in place, and one granted never appeared.
 *
 * The session now carries `permissionKeys`: the role's saved set for the
 * company being worked in, or null for a role nobody edited (which follows
 * the code, exactly as before). These helpers answer from it.
 *
 * A key is a gate's export name; a role array is recognised by its content,
 * since call sites pass copies. Pure — usable on the server and in the browser.
 */

let GATE_KEYS = null;
const signature = (roles) => [...new Set(roles)].sort().join("|");

/** Built on first use: role-gates and this module import each other. */
function gateKeyMap() {
  if (!GATE_KEYS) {
    GATE_KEYS = new Map();
    for (const [name, value] of Object.entries(gates)) {
      if (!Array.isArray(value)) continue;
      const sig = signature(value);
      GATE_KEYS.set(sig, [...(GATE_KEYS.get(sig) ?? []), name]);
    }
  }
  return GATE_KEYS;
}

/** The permission keys a role array stands for (empty when it is no gate). */
export function gateKeysFor(allowedRoles) {
  if (!Array.isArray(allowedRoles)) return [];
  return gateKeyMap().get(signature(allowedRoles)) ?? [];
}

/**
 * Does this user pass this role list, by their saved permissions?
 * Returns null when no saved set applies (no keys on the session, or a list
 * that is no catalog permission): the caller then uses the role list.
 */
export function holdsBySavedKeys(user, allowedRoles) {
  const keys = user?.permissionKeys;
  if (!Array.isArray(keys)) return null;
  if (user?.role === "SuperAdmin") return true;
  const wanted = gateKeysFor(allowedRoles);
  if (!wanted.length) return null;
  const held = new Set(keys);
  return wanted.some((k) => held.has(k));
}

/** A navigation / field permission by its catalog label ("See HR", …). */
export function holdsNavKey(user, label) {
  const keys = user?.permissionKeys;
  if (!Array.isArray(keys)) return null;
  if (user?.role === "SuperAdmin") return true;
  return keys.includes(label);
}

import type { Tx } from "./client";
import { roleAllowed } from "@/lib/permissions";
import { permittedBySavedRoles } from "./permissionGate";

/**
 * Does this user hold a gate, by the company's saved role permissions or, for
 * a role nobody edited, by the code defaults? For actions that admit more than
 * the gate — the person a task or ticket is assigned to may work it whatever
 * their role — and so call `withAuthorizedTenant([])` and decide here.
 */
export async function holdsGate(
  tx: Tx,
  user: { id?: string | null; role?: string | null },
  companyId: string,
  gate: readonly string[],
): Promise<boolean> {
  const role = String(user?.role ?? "");
  const saved = await permittedBySavedRoles(tx, String(user?.id ?? ""), companyId, role, gate);
  return saved ?? roleAllowed(role, gate as string[]);
}

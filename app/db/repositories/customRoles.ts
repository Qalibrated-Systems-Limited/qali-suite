import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { customRoles } from "../schema/customRoles";
import { userRoles } from "@/lib/utils";

const CANONICAL = new Set(userRoles);

export type CustomRoleRow = {
  id: string;
  name: string;
  baseRole: string;
  description: string;
  isSystem: boolean;
  isActive: boolean;
};

/**
 * Every custom role for the tenant, alphabetical. RLS scopes to the company;
 * an explicit company filter is passed too so a privileged/SuperAdmin
 * connection that bypasses RLS still sees only this company's roles.
 */
export async function listCustomRoles(
  tx: Tx,
  companyId?: string,
): Promise<CustomRoleRow[]> {
  const rows = await tx
    .select({
      id: customRoles.id,
      name: customRoles.name,
      baseRole: customRoles.baseRole,
      description: customRoles.description,
      isSystem: customRoles.isSystem,
      isActive: customRoles.isActive,
    })
    .from(customRoles)
    .where(companyId ? eq(customRoles.companyId, companyId) : undefined)
    .orderBy(asc(customRoles.name));
  return rows.map((r) => ({ ...r, description: r.description ?? "" }));
}

/** Just the names — for validating a role assignment and for pickers. */
export async function listCustomRoleNames(tx: Tx): Promise<string[]> {
  const rows = await tx.select({ name: customRoles.name }).from(customRoles);
  return rows.map((r) => r.name);
}

/** Is this a role a user can be assigned — a canonical role or a custom one? */
export async function isAssignableRole(tx: Tx, role: string): Promise<boolean> {
  if (!role) return false;
  if (CANONICAL.has(role)) return true;
  const [row] = await tx
    .select({ id: customRoles.id })
    .from(customRoles)
    .where(sql`lower(${customRoles.name}) = lower(${role})`)
    .limit(1);
  return Boolean(row);
}

function assertBase(baseRole: string) {
  if (!CANONICAL.has(baseRole)) {
    throw new Error(`"${baseRole}" is not a valid base role.`);
  }
}

function assertNameFree(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A role name is required.");
  if (CANONICAL.has(trimmed)) {
    throw new Error(`"${trimmed}" is a built-in role — choose another name.`);
  }
  return trimmed;
}

export async function createCustomRole(
  tx: Tx,
  companyId: string,
  input: {
    name: string;
    baseRole: string;
    description?: string;
    actor: { id?: string | null; name?: string | null };
  },
) {
  const name = assertNameFree(input.name);
  assertBase(input.baseRole);
  const [row] = await tx
    .insert(customRoles)
    .values({
      companyId,
      name,
      baseRole: input.baseRole,
      description: input.description?.trim() ?? "",
      isSystem: false,
      createdById: input.actor?.id ?? null,
      createdByName: input.actor?.name || "System",
    })
    .returning({ id: customRoles.id });
  return row;
}

export async function updateCustomRole(
  tx: Tx,
  id: string,
  input: { name?: string; baseRole?: string; description?: string },
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = assertNameFree(input.name);
  if (input.baseRole !== undefined) {
    assertBase(input.baseRole);
    patch.baseRole = input.baseRole;
  }
  if (input.description !== undefined) patch.description = input.description.trim();
  await tx.update(customRoles).set(patch).where(eq(customRoles.id, id));
}

/**
 * Delete a custom role. Users still carrying the name are handed back to the
 * caller so it can refuse or reassign — a deleted role that a user still holds
 * would resolve to nothing and lock them out.
 */
export async function customRoleInUse(
  tx: Tx,
  companyId: string,
  name: string,
): Promise<number> {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n
      FROM users u
      LEFT JOIN user_company_access a
        ON a.user_id = u.id AND a.company_id = ${companyId}::uuid
     WHERE lower(COALESCE(a.role, u.role)) = lower(${name})
       AND (a.company_id = ${companyId}::uuid OR u.home_company_id = ${companyId}::uuid)
  `)) as unknown as Array<{ n: number }>;
  return row?.n ?? 0;
}

export async function deleteCustomRole(tx: Tx, id: string) {
  await tx.delete(customRoles).where(eq(customRoles.id, id));
}

export async function getCustomRole(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(customRoles)
    .where(and(eq(customRoles.id, id)))
    .limit(1);
  return row ?? null;
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { ADMIN_ROLES } from "@/lib/utils/role-gates";
import * as repo from "../repositories/customRoles";

const ADMIN = ADMIN_ROLES as unknown as string[];

/** Read the tenant's custom roles. Open to anyone who can see settings. */
export async function getCustomRoles() {
  return withAuthorizedTenant([], (tx, { companyId }) =>
    repo.listCustomRoles(tx, companyId),
  );
}

const roleSchema = z.object({
  name: z.string().trim().min(2, "Give the role a name of at least 2 characters."),
  baseRole: z.string().min(1, "Pick a base role."),
  description: z.string().trim().max(240).optional().default(""),
});

export async function createCustomRoleAction(prevState, formData) {
  const parsed = roleSchema.safeParse({
    name: formData.get("name"),
    baseRole: formData.get("baseRole"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid role." };
  }
  try {
    await withAuthorizedTenant(ADMIN, (tx, { user, companyId }) =>
      repo.createCustomRole(tx, companyId, {
        ...parsed.data,
        actor: { id: user.id, name: user.name },
      }),
    );
    revalidatePath("/dashboard/settings/roles");
    return { success: true, message: `Role "${parsed.data.name}" created.` };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function updateCustomRoleAction(prevState, formData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "No role." };
  const parsed = roleSchema.safeParse({
    name: formData.get("name"),
    baseRole: formData.get("baseRole"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid role." };
  }
  try {
    await withAuthorizedTenant(ADMIN, async (tx, { companyId }) => {
      const existing = await repo.getCustomRole(tx, id);
      if (!existing) throw new Error("Role not found.");
      // Renaming a role in use would orphan its holders — block it.
      if (
        existing.name.toLowerCase() !== parsed.data.name.toLowerCase() &&
        (await repo.customRoleInUse(tx, companyId, existing.name)) > 0
      ) {
        throw new Error(
          "This role is assigned to people — reassign them before renaming it.",
        );
      }
      await repo.updateCustomRole(tx, id, parsed.data);
    });
    revalidatePath("/dashboard/settings/roles");
    return { success: true, message: "Role updated." };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

export async function deleteCustomRoleAction(id: string) {
  if (!id) return { error: "No role." };
  try {
    await withAuthorizedTenant(ADMIN, async (tx, { companyId }) => {
      const existing = await repo.getCustomRole(tx, id);
      if (!existing) return;
      const inUse = await repo.customRoleInUse(tx, companyId, existing.name);
      if (inUse > 0) {
        throw new Error(
          `This role is assigned to ${inUse} ${
            inUse === 1 ? "person" : "people"
          } — reassign them before deleting it.`,
        );
      }
      await repo.deleteCustomRole(tx, id);
    });
    revalidatePath("/dashboard/settings/roles");
    return { success: true };
  } catch (error) {
    return { error: userMessage(error) };
  }
}

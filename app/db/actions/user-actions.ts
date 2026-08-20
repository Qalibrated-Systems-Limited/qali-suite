"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withAuthorizedTenant } from "../tenant";
import { ADMIN_ROLES } from "@/lib/utils/role-gates";
import { userRoles } from "@/app/models/user";
import * as usersRepo from "../repositories/users";
import {
  adminUpdateUser,
  adminSetPassword,
  adminToggleStatus,
  adminDeleteUser,
  emailExists,
  countCompanyUsers,
  createUserFromInvite,
} from "../userAdmin";

/**
 * User administration on Postgres.
 *
 * READS go through withAuthorizedTenant and are scoped by 0036's
 * `visible_within_company` policy — the list is this company's staff because
 * the database says so, not because the query remembered a filter.
 *
 * WRITES go to userAdmin on the privileged connection, because an admin
 * editing somebody else's row is neither "your own row" nor "a colleague you
 * can read". The role gate is here, where the session is.
 */

export type ActionResult =
  | { success: true; userId?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

const userSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("A valid email is required"),
  role: z.enum(userRoles as [string, ...string[]]),
  department: z.string().optional().nullable(),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
});

function fail(err: unknown): ActionResult {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("no longer exists") ||
    message.includes("last active SuperAdmin") ||
    message.includes("permission") ||
    message.includes("seats") ||
    message.includes("already")
  ) {
    return { success: false, error: message };
  }
  console.error("[user-action]", err);
  return { success: false, error: "Something went wrong. Please try again." };
}

export async function createUserPg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = userSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    department: formData.get("department") || null,
    password: formData.get("password") || undefined,
  });
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const d = parsed.data;

  try {
    return await withAuthorizedTenant(
      [...ADMIN_ROLES],
      async (_tx, { user, companyId }) => {
        // Email is a platform-wide identity, so this is checked platform-wide
        // rather than within the company (0043's unique index enforces it too).
        if (await emailExists(d.email)) {
          return {
            success: false as const,
            error:
              "A user with this email already exists. Grant them access from the company's access list instead.",
          };
        }

        // The seat count is the COMPANY's, read from the company record
        // (0035) rather than from the session — a session minted before an
        // upgrade would still be carrying the old limit.
        const { getCompanySubscription } = await import("../platform");
        const company = await getCompanySubscription(companyId);
        const seats = await countCompanyUsers(companyId);
        const max = Number(company?.subscription?.maxUsers ?? 0);
        if (max > 0 && seats >= max) {
          return {
            success: false as const,
            error: `This plan allows ${max} seats and ${seats} are in use. Upgrade to add more.`,
          };
        }

        const id = randomUUID();
        await createUserFromInvite({
          id,
          name: d.name,
          email: d.email,
          role: d.role,
          companyId,
          passwordHash: d.password ? await bcrypt.hash(d.password, 10) : null,
          authProvider: "credentials",
          invitedById: user.id,
          invitedByName: user.name,
        });

        revalidatePath("/dashboard/users");
        return { success: true as const, userId: id, message: `${d.name} added` };
      },
    );
  } catch (err) {
    return fail(err);
  }
}

export async function updateUserPg(
  userId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    return await withAuthorizedTenant([...ADMIN_ROLES], async () => {
      const result = await adminUpdateUser({
        id: userId,
        name: (formData.get("name") as string) || null,
        email: (formData.get("email") as string) || null,
        role: (formData.get("role") as string) || null,
        department: (formData.get("department") as string) || null,
        status: (formData.get("status") as string) || null,
      });
      revalidatePath("/dashboard/users");
      revalidatePath(`/dashboard/users/${userId}`);
      return {
        success: true as const,
        userId,
        message:
          result.roleChanged || result.statusChanged
            ? "Saved. Their existing sessions have been ended."
            : "Saved",
      };
    });
  } catch (err) {
    return fail(err);
  }
}

export async function resetUserPasswordPg(
  userId: string,
  password: string,
): Promise<ActionResult> {
  if (!password || password.length < 6) {
    return { success: false, error: "Password must be at least 6 characters" };
  }
  try {
    return await withAuthorizedTenant([...ADMIN_ROLES], async () => {
      await adminSetPassword(userId, await bcrypt.hash(password, 10));
      revalidatePath(`/dashboard/users/${userId}`);
      return {
        success: true as const,
        userId,
        message: "Password reset. Their existing sessions have been ended.",
      };
    });
  } catch (err) {
    return fail(err);
  }
}

export async function toggleUserStatusPg(userId: string): Promise<ActionResult> {
  try {
    return await withAuthorizedTenant([...ADMIN_ROLES], async () => {
      const status = await adminToggleStatus(userId);
      revalidatePath("/dashboard/users");
      return {
        success: true as const,
        userId,
        message: status === "active" ? "User reactivated" : "User deactivated",
      };
    });
  } catch (err) {
    return fail(err);
  }
}

export async function deleteUserPg(userId: string): Promise<ActionResult> {
  try {
    return await withAuthorizedTenant([...ADMIN_ROLES], async (_tx, { user }) => {
      if (user.id === userId) {
        return { success: false as const, error: "You cannot delete your own login." };
      }
      await adminDeleteUser(userId);
      revalidatePath("/dashboard/users");
      return { success: true as const, message: "User removed" };
    });
  } catch (err) {
    return fail(err);
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function searchUsersPg(
  opts: {
    query?: string;
    page?: number;
    role?: string;
    status?: string;
    department?: string;
  } = {},
) {
  return withAuthorizedTenant([], (tx) => usersRepo.searchUsers(tx, opts));
}

export async function getUserStatsPg() {
  return withAuthorizedTenant([], (tx) => usersRepo.getUserStats(tx));
}

export async function getUserByIdPg(userId: string) {
  return withAuthorizedTenant([], (tx) => usersRepo.getUser(tx, userId));
}

export async function getDepartmentsPg() {
  return withAuthorizedTenant([], (tx) => usersRepo.listDepartments(tx));
}

export async function getCompanyUsersPg() {
  return withAuthorizedTenant([], (tx) => usersRepo.listCompanyUsers(tx));
}

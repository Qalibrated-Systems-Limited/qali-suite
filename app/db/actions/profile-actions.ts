"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { withAuthorizedTenant } from "../tenant";
import * as usersRepo from "../repositories/users";
import {
  getCredentialsForUser,
  updateOwnProfile,
  adminSetPassword,
} from "../userAdmin";
import { sql } from "drizzle-orm";

/**
 * A person's own profile: their name, their department, their password.
 *
 * WHAT THIS REPLACES. `app/mongodb/actions/profile-actions.js`, which read and
 * wrote the Mongo `User` model. Logins moved to Postgres in 0036, so both of
 * its functions had stopped doing anything:
 *
 *   updateProfile   `User.findByIdAndUpdate(session.user.id, …)` against a
 *                   collection nothing reads — the form reported success and
 *                   the name never changed.
 *
 *   changePassword  read `user.password` from Mongo and, on success, saved the
 *                   new one there. Sign-in compares against the POSTGRES
 *                   `password_hash` (auth.ts:133). So changing your password
 *                   either failed with "User not found" or appeared to work
 *                   and left you signing in with the old one for ever.
 *
 * The second is the one worth stating plainly: **no user could change their
 * own password**, and the form said it had worked.
 *
 * ROLE GATE: none. Everybody edits their own profile, and every query below is
 * keyed by the session's own user id — never by a value from the form.
 */

type Result = { success: boolean; error?: string; message?: string };

/** The house minimum, matching the admin reset path in user-actions.ts. */
const MIN_PASSWORD = 6;

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ? String(session.user.id) : null;
}

/**
 * The profile page's own record.
 *
 * `getUserByIdPg` returns the row, but the page needs two things it does not:
 * `hasPassword`, so it can offer "set a password" to somebody invited who has
 * never had one, and `companyId` under the name the page reads. Mongo answered
 * both from `select("+password")` and a `companyId` field.
 *
 * The HASH IS NEVER RETURNED, only whether one exists — as Mongo's version was
 * careful to do, and for the same reason.
 */
export async function getMyProfile() {
  const userId = await currentUserId();
  if (!userId) return null;

  const [row, creds] = await Promise.all([
    withAuthorizedTenant([], (tx) => usersRepo.getUser(tx, userId)),
    getCredentialsForUser(userId),
  ]);
  if (!row) return null;

  return {
    ...row,
    _id: row.id,
    companyId: row.homeCompanyId,
    hasPassword: Boolean(creds?.passwordHash),
  };
}

export async function updateProfile(data: {
  name?: string;
  department?: string;
}): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { success: false, error: "Unauthorized" };

  const name = (data?.name ?? "").trim();
  if (!name) return { success: false, error: "Name is required" };
  if (name.length > 50) {
    return { success: false, error: "Name cannot exceed 50 characters" };
  }

  const department =
    data?.department === undefined ? undefined : data.department.trim() || null;

  try {
    await updateOwnProfile(userId, { name, department });

    /**
     * The PARTY carries the same name, and it is the financial identity — the
     * one on a claim, an expense and the ledger's actor columns. Mongo kept the
     * two in step with `Party.findOneAndUpdate({ userId, type: "employee" })`.
     *
     * That link does not live on the party here. It is on the GRANT
     * (`user_company_access.party_id`, 0033), because a party is company-scoped
     * and one person may be an employee of one company and a supplier to
     * another — a single `userId` on the party could only ever name one of
     * them. So this resolves the party for the company being operated on, and
     * renames that one.
     */
    await withAuthorizedTenant([], async (tx, { companyId }) => {
      const partyId = await usersRepo.getUserParty(tx, userId, companyId);
      if (!partyId) return;
      await tx.execute(sql`
        UPDATE parties SET name = ${name}, updated_at = now()
         WHERE id = ${partyId}::uuid
      `);
    });

    revalidatePath("/dashboard/profile");
    return { success: true };
  } catch (error) {
    console.error("[updateProfile]", error);
    return { success: false, error: "Could not save your profile." };
  }
}

/**
 * Change or set your own password.
 *
 * Mongo's rules, kept: a Google login may not set a credentials password, and
 * somebody who already has one must prove it before replacing it. Somebody with
 * no password yet — invited, never signed in with credentials — sets one
 * without a current.
 *
 * ONE DELIBERATE ADDITION: this ends every session, including the one making
 * the request. `adminSetPassword` bumps `token_version`, and its own comment
 * says why — "a password is changed precisely when the old one is not to be
 * trusted". Mongo left other sessions alive on the old password. The caller is
 * told to sign in again rather than being left to wonder.
 */
export async function changePassword(data: {
  currentPassword?: string;
  newPassword?: string;
}): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { success: false, error: "Unauthorized" };

  const newPassword = data?.newPassword ?? "";
  if (!newPassword) return { success: false, error: "New password is required" };
  if (newPassword.length < MIN_PASSWORD) {
    return {
      success: false,
      error: `Password must be at least ${MIN_PASSWORD} characters`,
    };
  }

  try {
    const creds = await getCredentialsForUser(userId);
    if (!creds) return { success: false, error: "User not found" };

    if (creds.authProvider === "google") {
      return { success: false, error: "Google users cannot set a password" };
    }

    if (creds.passwordHash) {
      if (!data?.currentPassword) {
        return { success: false, error: "Current password is required" };
      }
      const matches = await bcrypt.compare(
        data.currentPassword,
        creds.passwordHash,
      );
      if (!matches) {
        return { success: false, error: "Current password is incorrect" };
      }
    }

    // Hashed here rather than by a model hook, because there is no model. The
    // cost factor matches auth.ts's expectation of a bcrypt hash.
    const hash = await bcrypt.hash(newPassword, 10);
    await adminSetPassword(userId, hash);

    return {
      success: true,
      message: "Password changed. Sign in again with your new password.",
    };
  } catch (error) {
    console.error("[changePassword]", error);
    return { success: false, error: "Could not change your password." };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import crypto, { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { withAuthorizedTenant } from "../tenant";
import { ADMIN_ROLES } from "@/lib/utils/role-gates";
import { userRoles } from "@/app/models/user";
import * as invitesRepo from "../repositories/invites";
import {
  findAcceptableInvite,
  acceptInvite as consumeInvite,
} from "../inviteAdmin";
import {
  createUserFromInvite,
  emailExists,
  linkUserToPartyDirect,
} from "../userAdmin";

/**
 * Invitations on Postgres (0044).
 *
 * ISSUING is a tenant operation and runs scoped: a company invites someone to
 * ITSELF, and the row it writes belongs to it.
 *
 * ACCEPTING is not. The person holding the link has no company yet, so it runs
 * privileged through inviteAdmin, authorised by the token — a sha256 of a
 * secret sent to one address. That scheme is unchanged from the source, so
 * links already in inboxes still work.
 */

export type ActionResult =
  | { success: true; inviteId?: string; rawToken?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/** 32 random bytes emailed, its sha256 stored — as the source did. */
function generateToken() {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  return { rawToken, hashedToken };
}

function hashOf(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function fail(err: unknown): ActionResult {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("no longer open") ||
    message.includes("already") ||
    message.includes("permission") ||
    message.includes("expired")
  ) {
    return { success: false, error: message };
  }
  console.error("[invite-action]", err);
  return { success: false, error: "Something went wrong. Please try again." };
}

const inviteSchema = z.object({
  email: z.string().email("A valid email is required"),
  role: z.enum(userRoles as [string, ...string[]]),
  partyId: z.string().optional().nullable(),
});

export async function sendInvitePg(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
    partyId: formData.get("partyId") || null,
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
      async (tx, { user, companyId }) => {
        if (await emailExists(d.email)) {
          return {
            success: false as const,
            error:
              "That email already has a login. Grant them access from the company's access list instead.",
          };
        }

        const { rawToken, hashedToken } = generateToken();
        try {
          const invite = await invitesRepo.createInvite(tx, {
            companyId,
            email: d.email,
            role: d.role,
            token: hashedToken,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            partyId: d.partyId || null,
            invitedById: user.id,
            invitedByName: user.name,
          });

          revalidatePath("/dashboard/users");
          // The RAW token goes in the email; only its hash is stored.
          return {
            success: true as const,
            inviteId: invite.id,
            rawToken,
            message: `Invitation sent to ${d.email}`,
          };
        } catch (err) {
          // 0044's partial unique index. The source checked first and raced;
          // here the second concurrent invite simply loses.
          const code = (err as { cause?: { code?: string } })?.cause?.code;
          if (code === "23505") {
            return {
              success: false as const,
              error: "That person already has an open invitation to this company.",
            };
          }
          throw err;
        }
      },
    );
  } catch (err) {
    return fail(err);
  }
}

/** The accept page reads this before anyone is signed in. */
export async function getInviteByTokenPg(rawToken: string) {
  const invite = await findAcceptableInvite(hashOf(rawToken));
  if (!invite) return null;
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    companyId: invite.companyId,
    invitedByName: invite.invitedByName,
    expiresAt: invite.expiresAt,
  };
}

/**
 * Turns an invitation into a login.
 *
 * Runs for someone with no session at all, so nothing here is scoped and
 * nothing about the request is trusted except the token.
 */
export async function acceptInviteWithPasswordPg(
  rawToken: string,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = z
    .object({
      name: z.string().min(2, "Your name is required"),
      password: z.string().min(6, "Password must be at least 6 characters"),
    })
    .safeParse({
      name: formData.get("name"),
      password: formData.get("password"),
    });
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const invite = await findAcceptableInvite(hashOf(rawToken));
    if (!invite) {
      return {
        success: false,
        error: "This invitation is no longer valid. Ask for a new one.",
      };
    }

    if (await emailExists(invite.email)) {
      return {
        success: false,
        error: "That email already has a login. Sign in instead.",
      };
    }

    const userId = randomUUID();
    await createUserFromInvite({
      id: userId,
      name: parsed.data.name,
      email: invite.email,
      role: invite.role,
      companyId: invite.companyId,
      passwordHash: await bcrypt.hash(parsed.data.password, 10),
      authProvider: "credentials",
      invitedById: invite.id,
      invitedByName: invite.invitedByName,
    });

    if (invite.partyId) {
      await linkUserToPartyDirect({
        userId,
        companyId: invite.companyId,
        partyId: invite.partyId,
      });
    }

    // Consumed last, and conditionally: if two clicks arrive together only one
    // UPDATE matches, so only one of them created the login it promised.
    const consumed = await consumeInvite(invite.id, userId);
    if (!consumed) {
      return {
        success: false,
        error: "This invitation has already been used.",
      };
    }

    return { success: true, message: "Your account is ready. Please sign in." };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelInvitePg(inviteId: string): Promise<ActionResult> {
  try {
    return await withAuthorizedTenant([...ADMIN_ROLES], async (tx) => {
      await invitesRepo.cancelInvite(tx, inviteId);
      revalidatePath("/dashboard/users");
      return { success: true as const, message: "Invitation cancelled" };
    });
  } catch (err) {
    return fail(err);
  }
}

/** Cancels the old invitation and issues a fresh one to the same address. */
export async function resendInvitePg(inviteId: string): Promise<ActionResult> {
  try {
    return await withAuthorizedTenant(
      [...ADMIN_ROLES],
      async (tx, { user, companyId }) => {
        const open = await invitesRepo.listInvites(tx, { status: "pending" });
        const existing = open.find((i) => i.id === inviteId);
        if (!existing) {
          return { success: false as const, error: "That invitation is no longer open." };
        }

        // Cancel first: the partial unique index allows only one open invite
        // per address per company, which is the rule that makes this safe.
        await invitesRepo.cancelInvite(tx, inviteId);

        const { rawToken, hashedToken } = generateToken();
        const fresh = await invitesRepo.createInvite(tx, {
          companyId,
          email: existing.email,
          role: existing.role,
          token: hashedToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          partyId: existing.partyId,
          invitedById: user.id,
          invitedByName: user.name,
        });

        revalidatePath("/dashboard/users");
        return {
          success: true as const,
          inviteId: fresh.id,
          rawToken,
          message: `Invitation resent to ${existing.email}`,
        };
      },
    );
  } catch (err) {
    return fail(err);
  }
}

export async function getCompanyInvitesPg(status = "pending") {
  return withAuthorizedTenant([...ADMIN_ROLES], async (tx) => {
    // Mark the lapsed ones before reading, so the list says "expired" without
    // every caller re-deriving it from a date.
    await invitesRepo.expireOverdueInvites(tx);
    return invitesRepo.listInvites(tx, { status });
  });
}

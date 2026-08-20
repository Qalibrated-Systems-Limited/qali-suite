import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../client";
import { invites } from "../schema/invites";

/**
 * Invitations, from inside a tenant (0044).
 *
 * Everything here runs under RLS, so it is the company's own invites and no
 * one else's. The ACCEPT path is not here — a person accepting an invite has
 * no tenant context yet, so it lives in inviteAdmin.ts on the privileged
 * connection, the same way company and user administration do.
 */

export interface CreateInviteInput {
  companyId: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
  partyId?: string | null;
  invitedById: string;
  invitedByName: string;
}

export async function createInvite(tx: Tx, input: CreateInviteInput) {
  const [row] = await tx
    .insert(invites)
    .values({
      companyId: input.companyId,
      email: input.email.toLowerCase().trim(),
      role: input.role,
      token: input.token,
      expiresAt: input.expiresAt,
      partyId: input.partyId ?? null,
      invitedById: input.invitedById,
      invitedByName: input.invitedByName,
      status: "pending",
    })
    .returning();
  return row;
}

/** The company's invites, newest first. */
export async function listInvites(
  tx: Tx,
  opts: { status?: string; limit?: number } = {},
) {
  const filters = [];
  if (opts.status && opts.status !== "all") {
    filters.push(eq(invites.status, opts.status));
  }
  return tx
    .select()
    .from(invites)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(invites.createdAt))
    .limit(Math.min(opts.limit ?? 100, 200));
}

/**
 * The open invite for an address in this company, if there is one.
 *
 * At most one can exist — 0044's partial unique index makes a second
 * impossible, where the source checked in the action and raced with itself.
 */
export async function findOpenInvite(tx: Tx, email: string) {
  const [row] = await tx
    .select()
    .from(invites)
    .where(
      and(
        sql`lower(${invites.email}) = ${email.toLowerCase().trim()}`,
        eq(invites.status, "pending"),
      ),
    );
  return row ?? null;
}

export async function cancelInvite(tx: Tx, inviteId: string) {
  const [row] = await tx
    .update(invites)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(invites.id, inviteId), eq(invites.status, "pending")))
    .returning();
  if (!row) {
    throw new Error("That invitation is no longer open.");
  }
  return row;
}

/**
 * Marks the ones whose time has passed.
 *
 * Expiry is a STATUS here rather than only a date comparison, because the list
 * a company reads should say "expired" without every reader re-deriving it.
 * Accepting still checks the date as well — a row this has not reached yet
 * must not be usable a moment after it expires.
 */
export async function expireOverdueInvites(tx: Tx) {
  const rows = await tx
    .update(invites)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(invites.status, "pending"), sql`${invites.expiresAt} < now()`))
    .returning({ id: invites.id });
  return rows.length;
}

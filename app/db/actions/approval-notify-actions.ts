"use server";

import { withAuthorizedTenant } from "../tenant";
import * as notifications from "../repositories/notifications";
import * as usersRepo from "../repositories/users";

/**
 * Who to tell about an approval, and their bell rows.
 *
 * The approval ENGINE stays on Mongo deliberately (2026-08-27 handoff). What
 * moved with 0074 is the two things it needed from stores that had already
 * gone: WHO the approvers are (`users`, since 0036) and WHERE the bell row
 * lands (`notifications`).
 *
 * `lib/notifications/approval-notify.js` had been reading the Mongo `User`
 * collection, so **every approval submitted since users ported notified and
 * emailed nobody** — and did so silently, because that file swallows its own
 * errors by design so a mail failure cannot fail an approval.
 *
 * THE TENANT COMES FROM THE SESSION, not from `approval.companyId`. All three
 * call sites are inside `approval-actions.js` server actions, so the session is
 * present; and the Mongo approval document carries an ObjectId, which is not a
 * company id Postgres can use. This is the same reasoning that makes
 * `translateCompanyId` a dead end for new tenants — the bug that started 0074.
 *
 * Both functions return the recipients so the caller can send the email. The
 * bell write and the email are separate failures: the row lands even if SMTP
 * is down.
 */

/** Safety ceiling — no tenant has this many approvers. */
const MAX_RECIPIENTS = 25;

export interface BellContent {
  type: "approval_request" | "approval_decision" | "system";
  title: string;
  body?: string | null;
  href?: string | null;
}

/**
 * Writes the bell for every active approver holding one of `roles`, and returns
 * them so the caller can email them.
 *
 * The submitter is excluded: nobody needs telling about their own request.
 */
export async function notifyApprovers(
  input: BellContent & { roles: readonly string[]; excludeUserId?: string | null },
): Promise<Array<{ id: string; name: string; email: string }>> {
  const { roles, excludeUserId, ...bell } = input;
  if (!roles?.length) return [];

  try {
    return await withAuthorizedTenant([], async (tx, { companyId }) => {
      const approvers = await usersRepo.listUsersByRole(tx, roles, MAX_RECIPIENTS);
      const recipients = approvers.filter(
        (u) => String(u.id) !== String(excludeUserId ?? ""),
      );
      if (recipients.length === 0) return [];

      await notifications.createMany(
        tx,
        recipients.map((u) => ({ companyId, userId: u.id, ...bell })),
      );

      return recipients.map((u) => ({ id: u.id, name: u.name, email: u.email }));
    });
  } catch (err) {
    // Best-effort, as the whole notification path is: an approval must not fail
    // because the bell could not be written.
    console.error("[notifyApprovers]", err);
    return [];
  }
}

/**
 * Writes one bell row for the person who raised the request, and returns them.
 *
 * Returns null when the id names nobody in this company — which IS the guard.
 * The Mongo version gated on `ObjectId.isValid(submitterId)` first, and that
 * has returned false for every user id since users became Postgres, so it
 * bailed before looking anybody up.
 */
export async function notifySubmitter(
  input: BellContent & { userId: string },
): Promise<{ id: string; name: string; email: string } | null> {
  const { userId, ...bell } = input;
  if (!userId) return null;

  try {
    return await withAuthorizedTenant([], async (tx, { companyId }) => {
      const user = await usersRepo.getUser(tx, userId);
      if (!user) return null;

      await notifications.createMany(tx, [
        { companyId, userId: user.id, ...bell },
      ]);

      return { id: user.id, name: user.name, email: user.email };
    });
  } catch (err) {
    console.error("[notifySubmitter]", err);
    return null;
  }
}

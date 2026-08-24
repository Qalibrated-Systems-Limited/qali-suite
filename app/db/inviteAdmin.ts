import { sql } from "drizzle-orm";
import { privilegedDb } from "./provisioning";

/**
 * Accepting an invitation, from outside any tenant (0044).
 *
 * A person clicking an invite link has no company yet — that is what the
 * invite is for — so `app.company_id` is unset and every RLS policy correctly
 * returns nothing. The lookup therefore runs on the privileged connection, the
 * same pattern as company and user administration: an operation on a record
 * from outside the record's own scope runs privileged, and the caller proves
 * its right some other way.
 *
 * HERE THE PROOF IS THE TOKEN. It is a hash of a secret sent to one email
 * address, unique platform-wide, so holding it is the authorisation. Nothing
 * else about the request is trusted — not a company id, not a role in a form.
 */

export interface AcceptableInvite {
  id: string;
  companyId: string;
  email: string;
  role: string;
  partyId: string | null;
  expiresAt: Date;
  /**
   * The USER who sent it. The accept path records the actor on the login and
   * the grant it creates, and was passing the INVITE's id instead — so
   * `created_by_id` and `granted_by_id` named a row in the wrong table. That
   * is also the column 0036 plans to put a foreign key on, which an invite id
   * would fail.
   */
  invitedById: string | null;
  invitedByName: string;
}

/**
 * The open, unexpired invite for this token hash, or null.
 *
 * Expiry is checked HERE as well as by the status, because a row the sweep has
 * not reached yet must not be usable a moment after it expires. The status is
 * for reading a list; the date is the rule.
 */
export async function findAcceptableInvite(
  tokenHash: string,
): Promise<AcceptableInvite | null> {
  const rows = (await privilegedDb().execute(sql`
    SELECT id, company_id, email, role, party_id, expires_at,
           invited_by_id, invited_by_name
      FROM invites
     WHERE token = ${tokenHash}
       AND status = 'pending'
       AND expires_at > now()
  `)) as unknown as Array<Record<string, unknown>>;

  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    email: String(r.email),
    role: String(r.role),
    partyId: (r.party_id as string) ?? null,
    expiresAt: r.expires_at as Date,
    invitedById: (r.invited_by_id as string) ?? null,
    invitedByName: String(r.invited_by_name),
  };
}

/**
 * Consumes the invite, once.
 *
 * The UPDATE carries `status = 'pending'` in its WHERE and returns the row, so
 * two clicks on the same link cannot both succeed: the second matches nothing.
 * The source read, then checked, then wrote — three steps a second request can
 * interleave with.
 */
export async function acceptInvite(
  inviteId: string,
  acceptedById: string,
): Promise<boolean> {
  const rows = (await privilegedDb().execute(sql`
    UPDATE invites
       SET status = 'accepted',
           accepted_at = now(),
           accepted_by_id = ${acceptedById},
           updated_at = now()
     WHERE id = ${inviteId}::uuid
       AND status = 'pending'
       AND expires_at > now()
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/**
 * The open invite for an email address, in any company.
 *
 * For the sign-in path, which knows an address and nothing else. Returns the
 * soonest to expire, so a person invited by two companies joins on the
 * invitation that was about to lapse rather than an arbitrary one.
 */
export async function findOpenInviteForEmail(
  email: string,
): Promise<AcceptableInvite | null> {
  const rows = (await privilegedDb().execute(sql`
    SELECT id, company_id, email, role, party_id, expires_at,
           invited_by_id, invited_by_name
      FROM invites
     WHERE lower(email) = ${email.toLowerCase().trim()}
       AND status = 'pending'
       AND expires_at > now()
     ORDER BY expires_at
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;

  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    email: String(r.email),
    role: String(r.role),
    partyId: (r.party_id as string) ?? null,
    expiresAt: r.expires_at as Date,
    invitedById: (r.invited_by_id as string) ?? null,
    invitedByName: String(r.invited_by_name),
  };
}

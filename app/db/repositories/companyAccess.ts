import { sql } from "drizzle-orm";
import type { Tx } from "../client";

/**
 * Which companies a user may operate in, and which one they are on.
 *
 * The two are different questions and stay separate: `allowed` is the set the
 * user is authorised for, `active` is the one this request runs against and the
 * only one RLS sees.
 */

export interface AllowedCompany {
  id: string;
  name: string;
  slug: string | null;
  isActive: boolean;
  /** Role for THIS company; null falls back to the user's global role. */
  role: string | null;
}

/**
 * The companies this user may switch into.
 *
 * Runs under withUserScope: the grants policy keys on app.user_id, and every
 * company-keyed table is invisible here, which is the correct answer to asking
 * them before a tenant is chosen.
 */
export async function listAllowedCompanies(
  tx: Tx,
  userId: string,
): Promise<AllowedCompany[]> {
  const rows = (await tx.execute(sql`
    SELECT c.id, c.name, c.slug, c.is_active, a.role
      FROM user_company_access a
      JOIN companies c ON c.id = a.company_id
     WHERE a.user_id = ${userId} AND a.status = 'active'
     ORDER BY c.name
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    slug: (r.slug as string) ?? null,
    isActive: Boolean(r.is_active),
    role: (r.role as string) ?? null,
  }));
}

/**
 * The company this request operates on.
 *
 * Returns null rather than guessing when the choice is open — the caller turns
 * that into "choose a company". Picking one silently would show somebody one
 * company's books while they believed they were reading another's.
 */
export function resolveActiveCompany(
  allowed: AllowedCompany[],
  requestedId?: string | null,
): AllowedCompany | null {
  const usable = allowed.filter((c) => c.isActive);
  if (!usable.length) return null;

  if (requestedId) {
    // A request for a company the user is not authorised for is refused, not
    // quietly replaced with one they are.
    return usable.find((c) => c.id === String(requestedId)) ?? null;
  }
  return usable.length === 1 ? usable[0] : null;
}

/**
 * Whether this user has ANY grant row, active or suspended.
 *
 * The seeding decision turns on this rather than on "has no active grants",
 * because those are different states: a user who has never been granted
 * anything needs seeding, and a user whose access was REVOKED must not be
 * silently re-granted by the next request. Caught by the test that revoked and
 * then found itself allowed back in.
 */
export async function hasAnyGrant(tx: Tx, userId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT 1 AS ok FROM user_company_access WHERE user_id = ${userId} LIMIT 1
  `)) as unknown as Array<unknown>;
  return rows.length > 0;
}

export async function grantAccess(
  tx: Tx,
  input: {
    userId: string;
    companyId: string;
    role?: string | null;
    grantedVia?: "primary" | "superadmin" | "invite" | "manual";
    grantedById?: string | null;
    grantedByName?: string | null;
  },
) {
  await tx.execute(sql`
    INSERT INTO user_company_access (
      user_id, company_id, role, status, granted_via, granted_by_id, granted_by_name
    ) VALUES (
      ${input.userId}, ${input.companyId}, ${input.role ?? null}, 'active',
      ${input.grantedVia ?? "manual"}, ${input.grantedById ?? null},
      ${input.grantedByName ?? null}
    )
    ON CONFLICT (user_id, company_id) DO UPDATE
      SET status = 'active', role = EXCLUDED.role, updated_at = now()
  `);
}

export async function revokeAccess(tx: Tx, userId: string, companyId: string) {
  await tx.execute(sql`
    UPDATE user_company_access SET status = 'suspended', updated_at = now()
     WHERE user_id = ${userId} AND company_id = ${companyId}
  `);
}

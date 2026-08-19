import { sql } from "drizzle-orm";
import { privilegedDb } from "./provisioning";

/**
 * Administering WHO MAY ENTER a company.
 *
 * A company-as-a-whole operation, like renaming or deactivating one, so it
 * runs where those do: the privileged connection, with the target tenant's
 * scope set. The grants policy (0033) lets a user read and write their OWN
 * rows, which is exactly right for the switcher and exactly wrong here —
 * granting somebody else access is not something the grantee's own scope can
 * or should be able to do.
 *
 * Keyed on the SOURCE company id, because that is what the admin pages carry;
 * everything below resolves it to the Postgres uuid first.
 */

/** The tenant's Postgres uuid, or null if it was never provisioned. */
async function companyUuidFor(sourceCompanyId: string) {
  const rows = (await privilegedDb().execute(sql`
    SELECT new_uuid FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${String(sourceCompanyId)}
  `)) as unknown as Array<{ new_uuid: string }>;
  return rows.length ? rows[0].new_uuid : null;
}

export interface CompanyMember {
  userId: string;
  /** Role for THIS company; null falls back to the user's global role. */
  role: string | null;
  status: string;
  grantedVia: string;
  grantedByName: string | null;
  createdAt: Date;
}

/**
 * Everyone granted access to this company, suspended ones included.
 *
 * Suspended rows are returned rather than filtered out: "removed in March" is
 * the answer to a question somebody will ask, and a list that silently drops
 * them cannot give it.
 */
export async function listCompanyMembers(
  sourceCompanyId: string,
): Promise<CompanyMember[]> {
  const companyId = await companyUuidFor(sourceCompanyId);
  if (!companyId) return [];

  const rows = (await privilegedDb().execute(sql`
    SELECT user_id, role, status, granted_via, granted_by_name, created_at
      FROM user_company_access
     WHERE company_id = ${companyId}
     ORDER BY created_at
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    userId: String(r.user_id),
    role: (r.role as string) ?? null,
    status: String(r.status),
    grantedVia: String(r.granted_via),
    grantedByName: (r.granted_by_name as string) ?? null,
    createdAt: new Date(r.created_at as string),
  }));
}

/**
 * Lets a user operate in this company.
 *
 * An upsert, so re-granting somebody who was suspended restores them rather
 * than failing on the unique index — which is what "add them back" means, and
 * keeps the row's history in one place instead of two.
 */
export async function grantCompanyAccess(input: {
  sourceCompanyId: string;
  userId: string;
  role?: string | null;
  grantedById?: string | null;
  grantedByName?: string | null;
}) {
  const companyId = await companyUuidFor(input.sourceCompanyId);
  if (!companyId) return { granted: false as const, reason: "not-provisioned" };

  const userId = String(input.userId ?? "").trim();
  if (!userId) return { granted: false as const, reason: "no-user" };

  await privilegedDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
    await tx.execute(sql`
      INSERT INTO user_company_access (
        user_id, company_id, role, status, granted_via,
        granted_by_id, granted_by_name
      ) VALUES (
        ${userId}, ${companyId}, ${input.role ?? null}, 'active', 'manual',
        ${input.grantedById ?? null}, ${input.grantedByName ?? null}
      )
      ON CONFLICT (user_id, company_id) DO UPDATE
        SET status          = 'active',
            role            = EXCLUDED.role,
            granted_by_id   = EXCLUDED.granted_by_id,
            granted_by_name = EXCLUDED.granted_by_name,
            updated_at      = now()
    `);
  });

  return { granted: true as const, companyId };
}

/**
 * Stops a user operating in this company.
 *
 * SUSPENDED, NOT DELETED. The row is the record that they had access, and
 * deleting it destroys the only answer to "who could read these books in
 * March". The gate reads `status = 'active'`, so a suspension takes effect on
 * the next request without waiting for their session to expire.
 */
export async function revokeCompanyAccess(
  sourceCompanyId: string,
  userId: string,
) {
  const companyId = await companyUuidFor(sourceCompanyId);
  if (!companyId) return { revoked: false as const };

  await privilegedDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
    await tx.execute(sql`
      UPDATE user_company_access
         SET status = 'suspended', updated_at = now()
       WHERE company_id = ${companyId} AND user_id = ${String(userId)}
    `);
  });

  return { revoked: true as const, companyId };
}

/**
 * Makes sure platform staff hold a grant for this company, and says which
 * tenant it is.
 *
 * A SuperAdmin's access is rows, not a role check (tenant.ts), which means
 * there is a moment where the rows can be missing: a company that was
 * provisioned before this person was made a SuperAdmin, or before the grants
 * table existed. Rather than leave them unable to open it, the grant is
 * written the moment they ask for it — recorded as 'superadmin', so it reads
 * as what it is, and so the fan-out at the next company creation finds them.
 *
 * Returns null for a company that has no Postgres tenant yet; the caller
 * provisions or refuses, which are different answers.
 */
export async function ensurePlatformGrant(
  sourceCompanyId: string,
  user: { id: string; name?: string | null },
) {
  const companyId = await companyUuidFor(sourceCompanyId);
  if (!companyId) return null;

  await privilegedDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
    await tx.execute(sql`
      INSERT INTO user_company_access (
        user_id, company_id, granted_via, granted_by_id, granted_by_name
      ) VALUES (
        ${String(user.id)}, ${companyId}, 'superadmin',
        ${String(user.id)}, ${user.name ?? "System"}
      )
      ON CONFLICT (user_id, company_id) DO UPDATE
        SET status = 'active', updated_at = now()
    `);
  });

  return companyId;
}

/**
 * Every provisioned tenant this user does NOT already hold, granted.
 *
 * The top-up for platform staff. Idempotent, and cheap enough to run on the
 * path where a SuperAdmin has been refused a company — which is the only place
 * it is called from, so the ordinary request pays nothing for it.
 */
export async function grantAllTenants(user: { id: string; name?: string | null }) {
  await privilegedDb().execute(sql`
    INSERT INTO user_company_access (
      user_id, company_id, granted_via, granted_by_id, granted_by_name
    )
    SELECT ${String(user.id)}::text, c.id, 'superadmin',
           ${String(user.id)}::text, ${user.name ?? "System"}::text
      FROM companies c
      JOIN _migration_id_map m
        ON m.new_uuid = c.id AND m.collection = 'companies'
    ON CONFLICT (user_id, company_id) DO UPDATE
      SET status = 'active', updated_at = now()
  `);
}

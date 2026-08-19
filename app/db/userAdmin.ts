import { sql } from "drizzle-orm";
import { privilegedDb } from "./provisioning";

/**
 * Writing a login that is not your own (0036).
 *
 * The users policy lets a person read and write their OWN row, and read the
 * colleagues they share a company with. That is right for the request path and
 * wrong here: an admin creating or editing somebody else is neither of those.
 *
 * So this runs on the privileged connection, the same way company
 * administration does — the pattern is "operations on a record from outside
 * the record's own scope run privileged, and the app checks the role".
 *
 * Mongo is still the writer of record for logins; this keeps Postgres in step
 * so the id on 47 actor columns resolves to a person. It becomes the writer at
 * the auth cutover, when credentials move.
 */

/** The tenant's Postgres uuid, or null if it was never provisioned. */
async function companyUuidFor(sourceCompanyId: string | null | undefined) {
  const key = String(sourceCompanyId ?? "").trim();
  if (!key) return null;
  const rows = (await privilegedDb().execute(sql`
    SELECT new_uuid FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${key}
  `)) as unknown as Array<{ new_uuid: string }>;
  return rows.length ? rows[0].new_uuid : null;
}

export interface SyncUserInput {
  /** The Mongo id. It IS the id here — see 0036. */
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  /** Mongo's "Active" / "Inactive". */
  status?: string | null;
  department?: string | null;
  avatar?: string | null;
  authProvider?: string | null;
  /** The Mongo company id; resolved to the tenant uuid. */
  companyId?: string | null;
  tokenVersion?: number | null;
  createdById?: string | null;
  createdByName?: string | null;
}

/**
 * Puts a login into Postgres, or brings it up to date.
 *
 * Only the fields supplied are written, so a caller that changed a role does
 * not blank a department it never saw.
 *
 * Returns `{ synced: false }` rather than throwing when there is no tenant for
 * the company: a login is not worth failing over an unprovisioned company, and
 * the backfill and the lazy seeding both catch it later.
 */
export async function syncUser(input: SyncUserInput) {
  const id = String(input.id ?? "").trim();
  if (!id) return { synced: false as const };

  const homeCompanyId = await companyUuidFor(input.companyId);
  const email = input.email ? String(input.email).toLowerCase().trim() : null;
  // Mongo says "Active"/"Inactive"; the column says lowercase, with a CHECK.
  const status = input.status
    ? String(input.status).toLowerCase() === "inactive"
      ? "inactive"
      : "active"
    : null;

  await privilegedDb().execute(sql`
    INSERT INTO users (
      id, name, email, role, status, department, avatar, auth_provider,
      home_company_id, token_version, created_by_id, created_by_name
    ) VALUES (
      ${id},
      ${input.name ?? "Unknown user"},
      ${email ?? `${id}@unknown.invalid`},
      ${input.role ?? "Employee"},
      ${status ?? "active"},
      ${input.department ?? null},
      ${input.avatar ?? null},
      ${input.authProvider ?? "credentials"},
      ${homeCompanyId}::uuid,
      ${input.tokenVersion ?? 0},
      ${input.createdById ?? null},
      ${input.createdByName ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      name            = COALESCE(${input.name ?? null}, users.name),
      email           = COALESCE(${email}, users.email),
      role            = COALESCE(${input.role ?? null}, users.role),
      status          = COALESCE(${status}, users.status),
      department      = COALESCE(${input.department ?? null}, users.department),
      avatar          = COALESCE(${input.avatar ?? null}, users.avatar),
      auth_provider   = COALESCE(${input.authProvider ?? null}, users.auth_provider),
      home_company_id = COALESCE(${homeCompanyId}::uuid, users.home_company_id),
      token_version   = COALESCE(${input.tokenVersion ?? null}, users.token_version),
      updated_at      = now()
  `);

  return { synced: true as const, homeCompanyId };
}

/**
 * Says which party a login is, in one company.
 *
 * On the grant, because a party is company-scoped (0036): a person who is an
 * employee of one company and a supplier to another has two party rows, and a
 * single link on `users` could only ever name one of them.
 *
 * Takes the Mongo party id and resolves it, since that is what the HR and user
 * records carry while both stores are live.
 */
export async function linkUserToParty(input: {
  userId: string;
  sourceCompanyId: string;
  sourcePartyId: string | null;
}) {
  const companyId = await companyUuidFor(input.sourceCompanyId);
  if (!companyId) return { linked: false as const };

  let partyUuid: string | null = null;
  if (input.sourcePartyId) {
    const rows = (await privilegedDb().execute(sql`
      SELECT new_uuid FROM _migration_id_map
       WHERE collection = 'parties' AND old_object_id = ${String(input.sourcePartyId)}
    `)) as unknown as Array<{ new_uuid: string }>;
    // A party that has not been backfilled yet is not an error: the link is
    // written when it is, and a half-migrated tenant must not fail a save.
    if (!rows.length) return { linked: false as const, reason: "party-not-migrated" };
    partyUuid = rows[0].new_uuid;
  }

  // RETURNING, so "there was no grant to write to" is distinguishable from
  // "written". The UPDATE matches nothing when a caller reaches here before
  // grantCompanyAccess — the real order is syncUser, grant, then link — and
  // reporting that as success hides the ordering bug in whichever call site
  // got it wrong.
  const written = (await privilegedDb().execute(sql`
    UPDATE user_company_access
       SET party_id = ${partyUuid}::uuid, updated_at = now()
     WHERE user_id = ${String(input.userId)} AND company_id = ${companyId}::uuid
    RETURNING id
  `)) as unknown as Array<{ id: string }>;

  if (!written.length) return { linked: false as const, reason: "no-grant" };

  return { linked: true as const, companyId, partyId: partyUuid };
}

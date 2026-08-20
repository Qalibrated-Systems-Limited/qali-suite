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

/**
 * The sign-in lookup (0043).
 *
 * Privileged, because signing in happens before any company is chosen — there
 * is no `app.company_id` to scope by, and the users policy would correctly
 * return nothing. The proof of identity is the password, checked by the caller
 * against the hash returned here.
 *
 * Returns the hash rather than comparing here so the comparison stays in
 * auth.ts beside the rest of the credential handling, and so nothing else is
 * tempted to use this as a login check.
 */
export async function findUserForSignIn(email: string) {
  const rows = (await privilegedDb().execute(sql`
    SELECT id, name, email, role, status, avatar, auth_provider,
           home_company_id, token_version, password_hash
      FROM users
     WHERE lower(email) = ${String(email).toLowerCase().trim()}
  `)) as unknown as Array<Record<string, unknown>>;

  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    name: String(r.name),
    email: String(r.email),
    role: String(r.role),
    status: String(r.status),
    avatar: (r.avatar as string) ?? null,
    authProvider: String(r.auth_provider),
    homeCompanyId: (r.home_company_id as string) ?? null,
    tokenVersion: Number(r.token_version ?? 0),
    /** Null for a Google user, who never had one (0043). */
    passwordHash: (r.password_hash as string) ?? null,
  };
}

/** The session-freshness check reads this on privileged routes. */
export async function getTokenVersion(userId: string): Promise<number | null> {
  const rows = (await privilegedDb().execute(sql`
    SELECT token_version FROM users WHERE id = ${String(userId)}
  `)) as unknown as Array<{ token_version: number }>;
  return rows.length ? Number(rows[0].token_version) : null;
}

/** Records a Google avatar change without touching anything else. */
export async function updateAvatar(userId: string, avatar: string) {
  await privilegedDb().execute(sql`
    UPDATE users SET avatar = ${avatar}, updated_at = now()
     WHERE id = ${String(userId)}
  `);
}

/**
 * Creates the login an accepted invitation promises.
 *
 * Privileged for the same reason as the invite lookup: the person has no
 * company until this row and its grant exist. The id is generated here rather
 * than taken from anywhere, because there is no Mongo document to mirror — this
 * is the first store to know about them.
 */
export async function createUserFromInvite(input: {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId: string;
  passwordHash?: string | null;
  authProvider?: string;
  avatar?: string | null;
  invitedById?: string | null;
  invitedByName?: string | null;
}) {
  await privilegedDb().execute(sql`
    INSERT INTO users (id, name, email, role, status, auth_provider, avatar,
                       home_company_id, token_version, password_hash,
                       created_by_id, created_by_name)
    VALUES (${input.id}, ${input.name},
            ${input.email.toLowerCase().trim()}, ${input.role}, 'active',
            ${input.authProvider ?? "credentials"}, ${input.avatar ?? null},
            ${input.companyId}::uuid, 0, ${input.passwordHash ?? null},
            ${input.invitedById ?? null}, ${input.invitedByName ?? null})
    ON CONFLICT (id) DO NOTHING
  `);

  // The grant is what actually lets them in; a user row without one is a login
  // that can sign in and open nothing.
  await privilegedDb().execute(sql`
    INSERT INTO user_company_access (user_id, company_id, granted_via,
                                     granted_by_id, granted_by_name)
    VALUES (${input.id}, ${input.companyId}::uuid, 'invite',
            ${input.invitedById ?? null}, ${input.invitedByName ?? null})
    ON CONFLICT DO NOTHING
  `);
}

/**
 * Says which party a login is, given ids Postgres already owns.
 *
 * The sibling above takes Mongo ids and resolves them, which was right while
 * the session carried them. Since the auth cutover the invite already holds a
 * tenant uuid and a party uuid, so there is nothing to translate — and going
 * through the translating version would look them up in _migration_id_map and
 * find nothing.
 *
 * Privileged because it runs during sign-in, before a tenant is scoped. The
 * composite foreign key on (party_id, company_id) is what keeps it honest:
 * this cannot point a grant at another company's party (0036).
 */
export async function linkUserToPartyDirect(input: {
  userId: string;
  companyId: string;
  partyId: string | null;
}) {
  const rows = (await privilegedDb().execute(sql`
    UPDATE user_company_access
       SET party_id = ${input.partyId}::uuid, updated_at = now()
     WHERE user_id = ${String(input.userId)}
       AND company_id = ${input.companyId}::uuid
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return { linked: rows.length > 0 };
}

/**
 * Status and token version, for the session-freshness check.
 *
 * The narrowest possible read on the hottest privileged path: two columns by
 * primary key. Returns null when the login is gone, which the caller treats as
 * a stale session rather than an error.
 */
export async function getUserStatusAndVersion(userId: string) {
  const rows = (await privilegedDb().execute(sql`
    SELECT status, token_version FROM users WHERE id = ${String(userId)}
  `)) as unknown as Array<{ status: string; token_version: number }>;
  if (!rows.length) return null;
  return {
    status: String(rows[0].status),
    tokenVersion: Number(rows[0].token_version ?? 0),
  };
}

/**
 * Administrative writes to someone else's login.
 *
 * All privileged, for the reason at the top of this file: the users policy
 * covers your own row and reading colleagues, and an admin editing another
 * person is neither. The ROLE CHECK IS THE CALLER'S — these functions do what
 * they are told, and the actions above them decide who may.
 */

/** Bumps token_version, which invalidates every issued session for this user. */
async function revokeSessions(userId: string) {
  await privilegedDb().execute(sql`
    UPDATE users SET token_version = token_version + 1, updated_at = now()
     WHERE id = ${String(userId)}
  `);
}

export async function adminUpdateUser(input: {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  department?: string | null;
  status?: string | null;
}) {
  const email = input.email ? String(input.email).toLowerCase().trim() : null;
  const status = input.status
    ? String(input.status).toLowerCase() === "inactive" ? "inactive" : "active"
    : null;

  const [before] = (await privilegedDb().execute(sql`
    SELECT role, status FROM users WHERE id = ${String(input.id)}
  `)) as unknown as Array<{ role: string; status: string }>;
  if (!before) throw new Error("That user no longer exists.");

  await privilegedDb().execute(sql`
    UPDATE users
       SET name       = COALESCE(${input.name ?? null}, name),
           email      = COALESCE(${email}, email),
           role       = COALESCE(${input.role ?? null}, role),
           department = COALESCE(${input.department ?? null}, department),
           status     = COALESCE(${status}, status),
           updated_at = now()
     WHERE id = ${String(input.id)}
  `);

  /**
   * A CHANGE OF PRIVILEGE ENDS THE SESSIONS THAT PREDATE IT.
   *
   * Demoting somebody or deactivating them means nothing while their existing
   * JWT still says otherwise, and it lives up to eight hours. Bumping
   * token_version makes the freshness check reject it on the next privileged
   * request — seconds, not hours.
   */
  const roleChanged = input.role != null && input.role !== before.role;
  const statusChanged = status != null && status !== before.status;
  if (roleChanged || statusChanged) await revokeSessions(input.id);

  return { roleChanged, statusChanged };
}

export async function adminSetPassword(userId: string, passwordHash: string) {
  await privilegedDb().execute(sql`
    UPDATE users
       SET password_hash = ${passwordHash},
           reset_password_token = NULL,
           reset_password_expire = NULL,
           token_version = token_version + 1,
           updated_at = now()
     WHERE id = ${String(userId)}
  `);
  // Sessions go with the old password, always: a password is changed precisely
  // when the old one is not to be trusted.
}

export async function adminToggleStatus(userId: string) {
  const rows = (await privilegedDb().execute(sql`
    UPDATE users
       SET status = CASE WHEN status = 'active' THEN 'inactive' ELSE 'active' END,
           token_version = token_version + 1,
           updated_at = now()
     WHERE id = ${String(userId)}
    RETURNING status
  `)) as unknown as Array<{ status: string }>;
  if (!rows.length) throw new Error("That user no longer exists.");
  return rows[0].status;
}

/**
 * Deletes a login.
 *
 * Refused when the person is the last active SuperAdmin — a platform with
 * nobody who can administer it is not a state to allow, and the source checked
 * this in the action where a concurrent delete could slip past.
 */
export async function adminDeleteUser(userId: string) {
  const [target] = (await privilegedDb().execute(sql`
    SELECT role, status FROM users WHERE id = ${String(userId)}
  `)) as unknown as Array<{ role: string; status: string }>;
  if (!target) throw new Error("That user no longer exists.");

  if (target.role === "SuperAdmin") {
    const [{ n }] = (await privilegedDb().execute(sql`
      SELECT COUNT(*)::int AS n FROM users
       WHERE role = 'SuperAdmin' AND status = 'active' AND id <> ${String(userId)}
    `)) as unknown as Array<{ n: number }>;
    if (Number(n) === 0) {
      throw new Error("This is the last active SuperAdmin and cannot be removed.");
    }
  }

  await privilegedDb().execute(sql`DELETE FROM users WHERE id = ${String(userId)}`);
  return { deleted: true as const };
}

/** True when the address is already a login. Platform-wide, as emails are. */
export async function emailExists(email: string) {
  const rows = (await privilegedDb().execute(sql`
    SELECT id FROM users WHERE lower(email) = ${String(email).toLowerCase().trim()}
  `)) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/** How many active logins hold a grant in this company — the seat count. */
export async function countCompanyUsers(companyId: string) {
  const [{ n }] = (await privilegedDb().execute(sql`
    SELECT COUNT(DISTINCT u.id)::int AS n
      FROM users u
      JOIN user_company_access a ON a.user_id = u.id AND a.status = 'active'
     WHERE a.company_id = ${companyId}::uuid AND u.status = 'active'
  `)) as unknown as Array<{ n: number }>;
  return Number(n);
}

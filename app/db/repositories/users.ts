import { sql } from "drizzle-orm";
import type { Tx } from "../client";

/**
 * Logins (0036).
 *
 * Reads go through RLS like everything else: a user sees their own row, plus
 * the colleagues they share an active grant with in the company this request
 * is scoped to. Never another tenant's users.
 */

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  department: string | null;
  avatar: string | null;
  authProvider: string;
  homeCompanyId: string | null;
  tokenVersion: number;
}

function shape(r: Record<string, unknown>): UserRow {
  return {
    id: String(r.id),
    name: String(r.name),
    email: String(r.email),
    role: String(r.role),
    status: String(r.status),
    department: (r.department as string) ?? null,
    avatar: (r.avatar as string) ?? null,
    authProvider: String(r.auth_provider),
    homeCompanyId: (r.home_company_id as string) ?? null,
    tokenVersion: Number(r.token_version),
  };
}

/** The people who may operate in the company this request is scoped to. */
export async function listCompanyUsers(tx: Tx): Promise<UserRow[]> {
  const rows = (await tx.execute(sql`
    SELECT u.* FROM users u ORDER BY u.name
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(shape);
}

export async function getUser(tx: Tx, userId: string): Promise<UserRow | null> {
  const rows = (await tx.execute(sql`
    SELECT * FROM users WHERE id = ${String(userId)}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.length ? shape(rows[0]) : null;
}

/**
 * Writes a login, creating it if this is the first time we have seen the id.
 *
 * An upsert rather than an insert because the ids come from a system that has
 * been running for years: every user predates this table, and they arrive one
 * at a time as each signs in or is touched by an admin action. Running it
 * twice must converge, not fail.
 *
 * Only the columns supplied are written. A caller that knows a user's name and
 * nothing else must not blank their department.
 */
export async function upsertUser(
  tx: Tx,
  input: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: string | null;
    status?: string | null;
    department?: string | null;
    avatar?: string | null;
    authProvider?: string | null;
    homeCompanyId?: string | null;
    tokenVersion?: number | null;
    createdById?: string | null;
    createdByName?: string | null;
  },
) {
  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("upsertUser requires a user id");

  // Insert needs a name and an email; update must not overwrite with nulls.
  const name = input.name ?? null;
  const email = input.email ? String(input.email).toLowerCase().trim() : null;

  await tx.execute(sql`
    INSERT INTO users (
      id, name, email, role, status, department, avatar, auth_provider,
      home_company_id, token_version, created_by_id, created_by_name
    ) VALUES (
      ${id},
      ${name ?? "Unknown user"},
      ${email ?? `${id}@unknown.invalid`},
      ${input.role ?? "Employee"},
      ${input.status ?? "active"},
      ${input.department ?? null},
      ${input.avatar ?? null},
      ${input.authProvider ?? "credentials"},
      ${input.homeCompanyId ?? null}::uuid,
      ${input.tokenVersion ?? 0},
      ${input.createdById ?? null},
      ${input.createdByName ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      name            = COALESCE(${name}, users.name),
      email           = COALESCE(${email}, users.email),
      role            = COALESCE(${input.role ?? null}, users.role),
      status          = COALESCE(${input.status ?? null}, users.status),
      department      = COALESCE(${input.department ?? null}, users.department),
      avatar          = COALESCE(${input.avatar ?? null}, users.avatar),
      auth_provider   = COALESCE(${input.authProvider ?? null}, users.auth_provider),
      home_company_id = COALESCE(${input.homeCompanyId ?? null}::uuid, users.home_company_id),
      token_version   = COALESCE(${input.tokenVersion ?? null}, users.token_version),
      updated_at      = now()
  `);
}

/**
 * Says which party this login is, in this company.
 *
 * On the grant, not on the user: a party is company-scoped, so a person who is
 * an employee of one company and a supplier to another has two party rows and
 * a single link on `users` could only ever name one of them.
 */
export async function linkUserToParty(
  tx: Tx,
  input: { userId: string; companyId: string; partyId: string | null },
) {
  await tx.execute(sql`
    UPDATE user_company_access
       SET party_id = ${input.partyId}::uuid, updated_at = now()
     WHERE user_id = ${String(input.userId)}
       AND company_id = ${input.companyId}::uuid
  `);
}

/** The party this login is in this company, or null. */
export async function getUserParty(
  tx: Tx,
  userId: string,
  companyId: string,
): Promise<string | null> {
  const rows = (await tx.execute(sql`
    SELECT party_id FROM user_company_access
     WHERE user_id = ${String(userId)} AND company_id = ${companyId}::uuid
  `)) as unknown as Array<{ party_id: string | null }>;
  return rows.length ? rows[0].party_id : null;
}

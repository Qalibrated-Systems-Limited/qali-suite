import { sql } from "drizzle-orm";
import { toDate } from "./sqlHelpers";
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
  createdAt: Date | null;
  updatedAt: Date | null;
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
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
  };
}

/** The people who may operate in the company this request is scoped to. */
export async function listCompanyUsers(tx: Tx): Promise<UserRow[]> {
  const rows = (await tx.execute(sql`
    SELECT u.* FROM users u ORDER BY u.name
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(shape);
}

/**
 * One login, with the role it holds IN THIS COMPANY.
 *
 * Resolved the same way `searchUsers` and `withAuthorizedTenant` resolve it, and
 * for a reason the edit form makes concrete: the list showed the per-company
 * role while this returned the global one, so an admin opening someone whose
 * two roles differed saw a Role field pre-selected to a value that was not the
 * one in the row they clicked — and saving the form unchanged would have
 * written that value to the grant.
 */
export async function getUser(
  tx: Tx,
  userId: string,
): Promise<(UserRow & { globalRole: string }) | null> {
  const rows = (await tx.execute(sql`
    SELECT u.*,
           COALESCE(a.role, u.role) AS role,
           u.role                   AS global_role
      FROM users u
      -- Named explicitly because own_grants (0033) shows a user their own
      -- grants in EVERY company; see the note in searchUsers.
      LEFT JOIN user_company_access a
             ON a.user_id = u.id
            AND a.status = 'active'
            AND a.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
     WHERE u.id = ${String(userId)}
  `)) as unknown as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  return { ...shape(rows[0]), globalRole: String(rows[0].global_role) };
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

/**
 * The users page: search, filters, paging and a total in one trip.
 *
 * NO companyId FILTER, and none is needed. 0036's `visible_within_company`
 * policy already restricts this to people holding an active grant in the
 * company this request is scoped to, so the list is the company's staff
 * because the database says so, not because the query remembered.
 */
export async function searchUsers(
  tx: Tx,
  opts: {
    query?: string;
    page?: number;
    perPage?: number;
    role?: string;
    status?: string;
    department?: string;
  } = {},
) {
  const perPage = Math.min(opts.perPage ?? 10, 200);
  const page = Math.max(opts.page ?? 1, 1);

  const where = [sql`TRUE`];
  if (opts.query) {
    const like = `%${opts.query}%`;
    where.push(sql`(u.name ILIKE ${like} OR u.email ILIKE ${like})`);
  }
  // The role FOR THIS COMPANY, matching what the list displays. Filtering on
  // `u.role` would have offered a filter whose results disagreed with the
  // column beside it the moment the two diverged, which is what 0064 makes
  // possible.
  if (opts.role && opts.role !== "all") {
    where.push(sql`COALESCE(a.role, u.role) = ${opts.role}`);
  }
  if (opts.status && opts.status !== "all") {
    where.push(sql`u.status = ${opts.status.toLowerCase()}`);
  }
  if (opts.department && opts.department !== "all") {
    where.push(sql`u.department = ${opts.department}`);
  }

  const rows = (await tx.execute(sql`
    SELECT u.id, u.name, u.email, u.status, u.department, u.avatar,
           u.auth_provider, u.home_company_id, u.created_at, u.updated_at,
           u.token_version,
           -- THE ROLE FOR THE COMPANY THIS REQUEST IS SCOPED TO, which since
           -- 0064 is the authoritative one. The same resolution
           -- withAuthorizedTenant performs, so the list shows what the user
           -- can actually do HERE rather than a global default that may not
           -- apply in this company at all.
           COALESCE(a.role, u.role) AS role,
           u.role                   AS global_role,
           COUNT(*) OVER ()::int AS total_count,
           c.name AS company_name
      FROM users u
      -- Their home company's name, when this request can see that company.
      -- 0024 keys the companies policy on its own id, so a user whose home is
      -- another tenant reads as null here rather than leaking a name.
      LEFT JOIN companies c ON c.id = u.home_company_id
      -- THE ONE EXCEPTION TO "never write a companyId filter", and it is not
      -- one: 0033's own_grants policy deliberately shows you YOUR OWN grants
      -- in every company, not just this one. All of them are legitimately
      -- visible, so without naming the company here the join would match
      -- several rows for the current user, duplicate them in the list, and
      -- pick whichever role came first. The predicate disambiguates rows RLS
      -- has already allowed; it is not standing in for RLS.
      LEFT JOIN user_company_access a
             ON a.user_id = u.id
            AND a.status = 'active'
            AND a.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
     WHERE ${sql.join(where, sql` AND `)}
     ORDER BY u.name
     LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
  `)) as unknown as Array<Record<string, unknown>>;

  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    // `_id` alongside `id`: the table and its links were written against Mongo
    // documents and key on _id. Shaped here rather than rewriting the
    // component, which the port has no reason to redesign.
    rows: rows.map((r) => ({
      ...shape(r),
      _id: String(r.id),
      companyName: (r.company_name as string) ?? null,
      /**
       * The identity-level role, kept alongside the per-company one `role`
       * now carries. Only SuperAdmin is meaningful here since 0064 — it is
       * what makes somebody platform staff — and a screen that wants to say
       * "this person is platform staff" needs to read it rather than infer it
       * from the role they hold in the company being viewed.
       */
      globalRole: String(r.global_role),
    })),
    total,
    page,
    perPage,
    pages: Math.max(Math.ceil(total / perPage), 1),
  };
}

/** Counts by status and role, for the cards above the list. */
export async function getUserStats(tx: Tx) {
  const [row] = (await tx.execute(sql`
    SELECT COUNT(*)::int                                      AS total,
           COUNT(*) FILTER (WHERE status = 'active')::int     AS active,
           COUNT(*) FILTER (WHERE status = 'inactive')::int   AS inactive,
           COUNT(*) FILTER (WHERE role = 'Admin')::int        AS admins
      FROM users
  `)) as unknown as Array<Record<string, unknown>>;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    total: n(row?.total),
    active: n(row?.active),
    inactive: n(row?.inactive),
    admins: n(row?.admins),
  };
}

/** The distinct departments in this company, for the filter. */
export async function listDepartments(tx: Tx) {
  const rows = (await tx.execute(sql`
    SELECT DISTINCT department FROM users
     WHERE department IS NOT NULL AND department <> ''
     ORDER BY department
  `)) as unknown as Array<{ department: string }>;
  return rows.map((r) => r.department);
}

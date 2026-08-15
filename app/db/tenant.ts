import { sql } from "drizzle-orm";
import { db, withTenant, type Tx } from "./client";
import { getTenantContext } from "@/lib/utils/tenant-utils";

/**
 * Bridge between the Mongo-era session and the Postgres tenant id.
 *
 * TRANSITIONAL. During the slice both stores are live: the session (and
 * next-auth JWT) still carries a Mongo ObjectId for companyId, while Postgres
 * keys everything on UUIDs allocated by the backfill. This resolves one to the
 * other through _migration_id_map.
 *
 * It disappears at cutover, when the session starts carrying the UUID directly.
 * Until then every Postgres-backed action goes through here, so there is
 * exactly one place that knows the two id spaces exist.
 */

// Company ids are immutable once mapped, so an in-process cache is safe. It is
// per-instance and rebuilt on cold start — no invalidation needed.
const companyUuidCache = new Map<string, string>();

export async function resolveCompanyUuid(
  mongoCompanyId: string,
): Promise<string> {
  const key = String(mongoCompanyId);
  const cached = companyUuidCache.get(key);
  if (cached) return cached;

  const rows = (await db.execute(sql`
    SELECT new_uuid FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${key}
  `)) as unknown as Array<{ new_uuid: string }>;

  if (!rows.length) {
    throw new Error(
      `Company ${key} has not been migrated to Postgres yet. ` +
        "Run the backfill for this tenant before enabling Postgres-backed features.",
    );
  }

  companyUuidCache.set(key, rows[0].new_uuid);
  return rows[0].new_uuid;
}

export interface ActionUser {
  id: string;
  name: string;
  role: string;
}

/**
 * Resolves the caller, checks the role allow-list, and runs `fn` inside an
 * RLS-scoped transaction.
 *
 * This is the seam described in docs/POSTGRES-MIGRATION-PLAN.md §4.1: auth and
 * permissions are decided here, SQL happens below in the repositories, and
 * neither layer does the other's job.
 */
export async function withAuthorizedTenant<T>(
  allowedRoles: string[],
  fn: (tx: Tx, ctx: { user: ActionUser; companyId: string }) => Promise<T>,
): Promise<T> {
  const { user, companyId } = await getTenantContext();

  if (!user) throw new Error("Not authenticated");
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    throw new Error("You don't have permission to perform this action.");
  }

  const companyUuid = await resolveCompanyUuid(companyId);

  return withTenant(companyUuid, (tx) =>
    fn(tx, { user: user as ActionUser, companyId: companyUuid }),
  );
}

/** Roles permitted to touch the ledger — mirrors the Mongo action layer. */
export const FINANCE_ROLES = [
  "SuperAdmin",
  "Admin",
  "CFO",
  "Finance Manager",
  "Accountant",
];

import { sql } from "drizzle-orm";
import { db, withTenant, type Tx } from "./client";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { provisionCompany } from "./provisioning";

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
 *
 * A tenant that has no mapping is PROVISIONED rather than refused. Companies
 * created through onboarding get their Postgres side as part of being created;
 * a missing mapping means the tenant predates that, and the product's answer
 * to that has to be "it works", not an error message about a migration the
 * person reading it has never heard of.
 */

// Company ids are immutable once mapped, so an in-process cache is safe. It is
// per-instance and rebuilt on cold start — no invalidation needed.
const companyUuidCache = new Map<string, string>();

export async function resolveCompanyUuid(
  mongoCompanyId: string,
  /** What the session knows about the tenant, for the provisioning fallback. */
  hint: { name?: string | null; code?: string | null } = {},
): Promise<string> {
  const key = String(mongoCompanyId);
  const cached = companyUuidCache.get(key);
  if (cached) return cached;

  const rows = (await db.execute(sql`
    SELECT new_uuid FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${key}
  `)) as unknown as Array<{ new_uuid: string }>;

  if (rows.length) {
    companyUuidCache.set(key, rows[0].new_uuid);
    return rows[0].new_uuid;
  }

  // Not provisioned. Every company created through onboarding is provisioned
  // as part of being created, so this is a tenant that predates that — and the
  // fix is to provision it, not to tell somebody in accounts payable to run a
  // script.
  //
  // Provisioning is idempotent and keyed on this id, so two concurrent
  // requests for the same unprovisioned tenant converge on one company rather
  // than racing to create two.
  //
  // This creates an EMPTY tenant: chart of accounts and fiscal periods, no
  // documents. Moving historical data is a separate, deliberate operation
  // (app/db/backfill), not something a page load should start.
  const provisioned = await provisionCompany({
    sourceCompanyId: key,
    name: hint.name ?? hint.code ?? `Company ${key.slice(-6)}`,
    slug: hint.code ?? key,
  });

  companyUuidCache.set(key, provisioned.companyId);
  return provisioned.companyId;
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
  const { user, companyId, companyCode } = await getTenantContext();

  if (!user) throw new Error("Not authenticated");
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    throw new Error("You don't have permission to perform this action.");
  }

  // The session carries a company CODE, not a name. It is the best label
  // available here, and provisioning only needs one to put on the row.
  const companyUuid = await resolveCompanyUuid(companyId, { code: companyCode });

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

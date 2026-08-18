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

/**
 * Refuses a deactivated tenant.
 *
 * `companies.is_active` existed and NOTHING read it — not the policies, not a
 * repository — so deactivating a company greyed it out in an admin list while
 * its books stayed readable and writable. A flag nothing enforces is worse
 * than no flag, because it reads like a control.
 *
 * Checked here rather than in a policy because RLS decides which rows a tenant
 * can see, and this is a question about the tenant itself. Cached alongside
 * the uuid resolution it follows, and invalidated by setCompanyActive.
 */
const activeCache = new Map<string, boolean>();

async function assertCompanyActive(
  companyUuid: string,
  sourceKey: string,
  role?: string,
) {
  // A SuperAdmin is platform staff, not a tenant user. Locking them out of a
  // deactivated company would mean the only people who can reactivate it
  // cannot open it — a trap that springs the moment the control is used.
  if (role === "SuperAdmin") return;

  if (activeCache.get(companyUuid)) return;

  // Scoped, because since 0024 `companies` is itself under RLS keyed on its
  // own id. Read on an unscoped connection it returns zero rows and every
  // tenant looks deactivated — which is how this was first written, and what
  // the provisioning tests caught.
  const rows = await withTenant(companyUuid, async (tx) => {
    return (await tx.execute(sql`
      SELECT is_active FROM companies WHERE id = ${companyUuid}
    `)) as unknown as Array<{ is_active: boolean }>;
  });

  // NO ROW IS NOT "DEACTIVATED". It means the id map points at a company that
  // is no longer there, so what this process cached is stale — and telling
  // somebody their company is deactivated when the row was dropped underneath
  // them sends them to an administrator who will find nothing wrong.
  //
  // Drop the stale entries and let the caller re-resolve, which provisions the
  // tenant again. Reported by a developer whose dev database had been
  // truncated by the test suite; a restore from backup does the same.
  if (!rows.length) {
    companyUuidCache.delete(sourceKey);
    activeCache.delete(companyUuid);
    throw new StaleTenantMapping(sourceKey);
  }

  if (!rows[0].is_active) {
    throw new Error("This company is not active. Contact your administrator.");
  }
  activeCache.set(companyUuid, true);
}

/** Thrown when the cached mapping outlived the company row. Retried once. */
class StaleTenantMapping extends Error {
  constructor(readonly sourceKey: string) {
    super(`Tenant mapping for ${sourceKey} is stale`);
  }
}

/** Called when a tenant is activated or deactivated, so the gate reacts. */
export function forgetCompanyActive(companyUuid: string) {
  activeCache.delete(companyUuid);
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
  const hint = { code: companyCode };
  let companyUuid = await resolveCompanyUuid(companyId, hint);

  try {
    await assertCompanyActive(companyUuid, String(companyId), user.role);
  } catch (err) {
    if (!(err instanceof StaleTenantMapping)) throw err;
    // Resolve again with the caches cleared: the tenant is re-provisioned and
    // the request carries on, rather than failing on a fact about this
    // process's memory that nobody reading the message can act on.
    companyUuid = await resolveCompanyUuid(companyId, hint);
    await assertCompanyActive(companyUuid, String(companyId), user.role);
  }

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

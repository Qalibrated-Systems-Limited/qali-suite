import { sql } from "drizzle-orm";
import { db, withTenant, withUserScope, type Tx } from "./client";
import { upsertUser } from "./repositories/users";
import {
  listAllowedCompanies,
  resolveActiveCompany,
  grantAccess,
  hasAnyGrant,
} from "./repositories/companyAccess";
import { grantAllTenants } from "./companyAccessAdmin";
import { getTenantContext } from "@/lib/utils/tenant-utils";
import { roleAllowed } from "@/lib/permissions";
import {
  provisionCompany,
  forgetCompanyMapping,
  listProvisionedTenants,
} from "./provisioning";

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

/**
 * The tenant's uuid, or null — WITHOUT provisioning one.
 *
 * resolveCompanyUuid creates the tenant when there is no mapping, which is
 * right on the request path: a company that predates provisioning should just
 * work. It is wrong for a READ. Asking "what is my VAT rate" must not
 * manufacture a company, a chart of accounts and twelve fiscal periods as a
 * side effect — and a caller that asks about a tenant that is not there wants
 * to know that, not to be handed a brand-new empty one.
 */
export async function lookupCompanyUuid(
  mongoCompanyId: string | null | undefined,
): Promise<string | null> {
  if (!isUsableCompanyId(mongoCompanyId)) return null;

  const key = String(mongoCompanyId);
  const cached = companyUuidCache.get(key);
  if (cached) return cached;

  const rows = (await db.execute(sql`
    SELECT c.id
      FROM _migration_id_map m
      JOIN companies c ON c.id = m.new_uuid
     WHERE m.collection = 'companies' AND m.old_object_id = ${key}
  `)) as unknown as Array<{ id: string }>;

  if (!rows.length) return null;
  companyUuidCache.set(key, rows[0].id);
  return rows[0].id;
}

export async function resolveCompanyUuid(
  mongoCompanyId: string | null | undefined,
  /** What the session knows about the tenant, for the provisioning fallback. */
  hint: { name?: string | null; code?: string | null } = {},
): Promise<string> {
  // NEVER INVENT A TENANT FROM A MISSING ID. A SuperAdmin's companyId is a UX
  // hint and can be absent (lib/utils/tenant-utils.js says so), so this was
  // reached with null, stringified to "null", and provisioned a company called
  // "Company null" with slug "null" — a real tenant row, in the tenant list,
  // created by opening a dashboard page.
  if (!isUsableCompanyId(mongoCompanyId)) {
    throw new Error(
      "No company selected. Choose a company before opening this page.",
    );
  }

  const key = String(mongoCompanyId);
  const cached = companyUuidCache.get(key);
  if (cached) return cached;

  /**
   * ALREADY A TENANT ID. Since the auth cutover the session carries the
   * Postgres uuid directly — users.home_company_id — not the Mongo id this
   * function was written to translate.
   *
   * Without this the uuid would miss _migration_id_map, fall through to the
   * provisioning branch below, and CREATE A SECOND COMPANY for a tenant that
   * already exists. Verified against `companies` rather than trusted on shape,
   * so a well-formed uuid naming no company is still refused.
   */
  if (UUID_RE.test(key)) {
    const live = (await db.execute(sql`
      SELECT id FROM companies WHERE id = ${key}::uuid
    `)) as unknown as Array<{ id: string }>;
    if (live.length) {
      companyUuidCache.set(key, key);
      return key;
    }
    throw new Error("That company no longer exists. Choose another.");
  }

  const rows = (await db.execute(sql`
    SELECT new_uuid FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${key}
  `)) as unknown as Array<{ new_uuid: string }>;

  if (rows.length) {
    // A MAPPING IS NOT PROOF THE COMPANY IS THERE. The row can go while the
    // mapping stays — a restore, or the test suite truncating the database it
    // shares with the dev server, which is how this was found. Checking here
    // means every caller gets a uuid that resolves to something, instead of
    // each one discovering the hole differently.
    const alive = (await db.execute(sql`
      SELECT 1 AS ok FROM companies WHERE id = ${rows[0].new_uuid}
    `)) as unknown as Array<unknown>;

    if (alive.length) {
      companyUuidCache.set(key, rows[0].new_uuid);
      return rows[0].new_uuid;
    }

    companyUuidCache.delete(key);
    await forgetCompanyMapping(key);
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUsableCompanyId(value: unknown): value is string {
  const s = String(value ?? "").trim();
  return s !== "" && s !== "null" && s !== "undefined";
}

export interface ActionUser {
  id: string;
  name: string;
  role: string;
  /** Present from the session; used to seed the users table (0036). */
  email?: string | null;
}

/**
 * Which tenant this request acts as.
 *
 * AUTHORISATION IS A SET; OPERATING CONTEXT IS ONE OF IT. The grants say which
 * companies the user may enter (0033); the session says which one they are on.
 * RLS is scoped to that one, never to the set — `company_id = ANY(allowed)`
 * would make an ordinary list return several companies' ledgers together,
 * which is not a broader view of the books but a meaningless one.
 *
 * A SuperAdmin is not an exemption from this, only a user with more grants.
 * Nothing here needs a database role that bypasses row-level security.
 *
 * The grants are re-read every request rather than trusted from the token, so
 * revoking access or deactivating a company takes effect immediately instead
 * of at the next refresh.
 */
async function resolveActingCompany(
  user: ActionUser,
  sessionCompanyId: unknown,
  sessionCompanyCode: unknown,
  activeCompanyId: unknown,
): Promise<{ companyUuid: string; role: string }> {
  const { allowed: granted, seeded } = await withUserScope(
    user.id,
    async (tx) => ({
      allowed: await listAllowedCompanies(tx, user.id),
      // Any row, not any ACTIVE row: a user whose access was revoked must not
      // be re-granted by the next request, and "no active grants" cannot tell
      // that apart from "never granted anything".
      seeded: await hasAnyGrant(tx, user.id),
    }),
  );

  // NOTHING GRANTED YET. Every user predates this table, so the grants are
  // seeded from what the system already believed — lazily, so nobody is locked
  // out by a script that has not been run, and idempotently, so it converges
  // whether it runs once or on every request.
  const allowed =
    granted.length || seeded
      ? granted
      : await seedGrants(user, sessionCompanyId, sessionCompanyCode);

  const requested = isUsableCompanyId(activeCompanyId)
    ? String(activeCompanyId)
    : null;
  let active = resolveActiveCompany(allowed, requested);

  /**
   * PLATFORM STAFF HOLD STANDING ACCESS, AND IT IS STILL A ROW.
   *
   * Of the two ways ERPs let platform staff in — standing (NetSuite's
   * Administrator, a Dynamics sysadmin, who simply hold every company in the
   * deployment) and granted-per-company (Xero, QuickBooks, SAP's separation of
   * duties, where each one is handed over and audited) — this is the first,
   * written down as the second. A SuperAdmin ends up holding every tenant, but
   * by a dated, named, revocable row that shows on that company's access list,
   * not by a role check scattered through the code. That is what answers "who
   * could read these books in March".
   *
   * Topped up HERE, on the path where they would otherwise be refused, so an
   * ordinary request pays nothing for it. It is reached by a SuperAdmin who
   * predates a company, or a company that predates them — neither of which
   * should mean the only people who can repair a tenant cannot open it.
   *
   * Standing means standing: revoking a SuperAdmin is undone the next time
   * they are refused. Take the SuperAdmin role away instead — that is the
   * control, and the access card says so.
   */
  if (!active && user.role === "SuperAdmin") {
    await grantAllTenants({ id: user.id, name: user.name });
    const toppedUp = await withUserScope(user.id, (tx) =>
      listAllowedCompanies(tx, user.id),
    );
    active = resolveActiveCompany(toppedUp, requested);
    if (active) return { companyUuid: active.id, role: active.role ?? user.role };
    allowed.splice(0, allowed.length, ...toppedUp);
  }

  if (active) return { companyUuid: active.id, role: active.role ?? user.role };

  if (requested) {
    throw new Error("You do not have access to that company. Choose another.");
  }

  const usable = allowed.filter((c) => c.isActive);
  throw new Error(
    usable.length === 0
      ? allowed.length === 0
        ? "You do not have access to any company. Contact your administrator."
        : "This company is not active. Contact your administrator."
      : `No company selected. You have access to ${usable.length}. Choose one before opening this page.`,
  );
}

/**
 * Derives grants from what the system believed before this table existed.
 *
 * A SuperAdmin manages every company, so they get one grant each — written
 * down rather than implied by a role check scattered through the code, which
 * is what answers "who could see this company in March". Anyone else gets
 * their home company.
 */
async function seedGrants(
  user: ActionUser,
  sessionCompanyId: unknown,
  sessionCompanyCode: unknown,
) {
  const reread = () =>
    withUserScope(user.id, (tx) => listAllowedCompanies(tx, user.id));

  /**
   * The login itself, recorded the first time we seed for this person (0036).
   *
   * Here rather than on every request: an upsert per request is a write per
   * request for a row that changes when an admin edits it, which is rare.
   * Every user predates the table, so they arrive one at a time as each is
   * first seen — the same laziness the grants use, for the same reason.
   *
   * A failure does not stop the request. Nothing reads `users` on this path
   * yet; the grants are what the gate obeys, and refusing somebody entry
   * because their identity row could not be written would be a new way to
   * lock people out of working books.
   */
  const recordUser = async (homeCompanyId: string | null) => {
    try {
      await withUserScope(user.id, (tx) =>
        upsertUser(tx, {
          id: user.id,
          name: user.name,
          email: user.email ?? null,
          role: user.role,
          homeCompanyId,
        }),
      );
    } catch (err) {
      console.error("Could not record user in Postgres:", err);
    }
  };

  if (user.role === "SuperAdmin") {
    const tenants = await listProvisionedTenants();
    if (tenants.length) {
      await withUserScope(user.id, async (tx) => {
        for (const t of tenants) {
          await grantAccess(tx, {
            userId: user.id,
            companyId: t.id,
            grantedVia: "superadmin",
            grantedByName: "System",
          });
        }
      });
      // Platform staff belong to no company, so no home company.
      await recordUser(null);
      return reread();
    }
  }

  if (!isUsableCompanyId(sessionCompanyId)) {
    throw new Error(
      user.role === "SuperAdmin"
        ? "No company has been set up yet. Create one under Admin → Companies."
        : "No company selected. Choose a company before opening this page.",
    );
  }

  const companyUuid = await resolveCompanyUuid(sessionCompanyId, {
    code: sessionCompanyCode as string | null,
  });
  await withUserScope(user.id, (tx) =>
    grantAccess(tx, {
      userId: user.id,
      companyId: companyUuid,
      grantedVia: "primary",
      grantedByName: "System",
    }),
  );
  await recordUser(companyUuid);
  return reread();
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
  const { user, companyId, companyCode, activeCompanyId } =
    await getTenantContext();

  if (!user) throw new Error("Not authenticated");
  // roleAllowed, not allowList.includes: it grants SuperAdmin without every
  // call site having to remember to list them, which is the whole point of
  // the helper — and under the standing-access model a SuperAdmin who has
  // entered a company acts with full authority INSIDE it, on that company's
  // rows only. The gate runs again below against the role for the ACTIVE
  // company, which is the one that decides what this request may do.
  if (allowedRoles.length && !roleAllowed(user.role, allowedRoles)) {
    throw new Error("You don't have permission to perform this action.");
  }

  // The session carries a company CODE, not a name. It is the best label
  // available here, and provisioning only needs one to put on the row.
  const acting = await resolveActingCompany(
    user as ActionUser,
    companyId,
    companyCode,
    activeCompanyId,
  );

  // The role for the ACTIVE company. Null on the grant means the global role,
  // which is what every grant carried over from the single-company model says.
  const actingUser = { ...(user as ActionUser), role: acting.role };
  if (allowedRoles.length && !roleAllowed(actingUser.role, allowedRoles)) {
    throw new Error("You don't have permission to perform this action.");
  }

  return withTenant(
    acting.companyUuid,
    (tx) => fn(tx, { user: actingUser, companyId: acting.companyUuid }),
    actingUser.id,
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

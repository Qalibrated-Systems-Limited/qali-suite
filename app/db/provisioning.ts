import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";
import type { Tx } from "./client";
import { getStandardChartOfAccounts } from "@/lib/chart-of-accounts";

/**
 * Provisioning a tenant into Postgres.
 *
 * WHY THIS HAS ITS OWN CONNECTION. Since migration 0024 `companies` is under
 * row-level security keyed on its own `id`, with a WITH CHECK. That is what
 * stops any application connection enumerating every tenant on the platform.
 * It also means creating a company is NOT a tenant operation: a connection
 * scoped to tenant A has no business inserting tenant B, and cannot insert A
 * either, because A does not exist yet to be scoped to.
 *
 * `_migration_id_map` is the same story from the other side — `app_user` holds
 * SELECT on it and nothing more (§9A.1), because only provisioning writes it.
 *
 * So this runs on DIRECT_DATABASE_URL, the owner connection, and is the only
 * thing in the request path that does. Everything it creates AFTER the company
 * row exists is written through normal tenant scoping, so the seeded chart of
 * accounts and fiscal periods go through exactly the same RLS path the
 * application uses — a policy bug fails here rather than in production.
 */

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export function privilegedDb() {
  return privileged();
}

function privileged() {
  if (_db) return _db;

  // Falls back to DATABASE_URL so a single-database local setup still works.
  // Where they differ, DIRECT_DATABASE_URL is the unpooled owner connection:
  // provisioning runs DDL-adjacent work in one long transaction, which
  // transaction-mode pooling would break.
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL is not set — see .env.example");

  // Small and short-lived on purpose. This pool exists for provisioning and
  // company administration — a handful of calls in a tenant's lifetime — so
  // holding connections open costs a slot on the database for nothing, and an
  // idle connection here is one that a TRUNCATE or a migration has to wait on.
  _client = postgres(url, { max: 2, prepare: false, idle_timeout: 20 });
  _db = drizzle(_client, { schema });
  return _db;
}

export interface ProvisionCompanyInput {
  /** The id the session carries. Mapped, not converted — ObjectIds are not UUIDs. */
  sourceCompanyId: string;
  name: string;
  slug?: string | null;
  baseCurrency?: string | null;
  /** Any date inside the first period; the year is what matters. */
  fiscalYearStart?: Date | string | null;
  seedAccounts?: boolean;
  initFiscalPeriods?: boolean;
  /**
   * Who created it. Gets the first grant, so the company is not born with
   * nobody able to enter it. Optional: an operator script backfilling
   * pre-existing tenants has no creator, and those users are seeded on their
   * first request instead (tenant.ts).
   */
  ownerUserId?: string | null;
  ownerName?: string | null;
  /**
   * The creator's role. A SuperAdmin's grant is recorded as 'superadmin' so
   * the fan-out above finds them when the NEXT company is created; anyone else
   * gets 'primary', their home company.
   */
  ownerRole?: string | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Creates the tenant, its chart of accounts and its fiscal periods.
 *
 * IDEMPOTENT. Called twice for the same source id it returns the existing uuid
 * and adds nothing: the id map is the record of whether a tenant has been
 * provisioned, and re-running must not raise or duplicate. That matters because
 * onboarding can be retried after a partial failure, and because the operator
 * script for pre-existing tenants runs over every company each time.
 *
 * Returns the tenant's Postgres uuid.
 */
export async function provisionCompany(input: ProvisionCompanyInput) {
  const db = privileged();
  const sourceId = String(input.sourceCompanyId ?? "").trim();
  if (!sourceId || sourceId === "null" || sourceId === "undefined") {
    throw new Error("provisionCompany requires a source company id");
  }

  const existing = (await db.execute(sql`
    SELECT new_uuid FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${sourceId}
  `)) as unknown as Array<{ new_uuid: string }>;

  if (existing.length) {
    return { companyId: existing[0].new_uuid, created: false };
  }

  const companyId = crypto.randomUUID();
  /** Set when another request won the race while this one waited on the lock. */
  let adopted: string | null = null;

  await db.transaction(async (tx) => {
    /**
     * SERIALISED PER TENANT, AND RE-CHECKED INSIDE.
     *
     * The lookup above is outside this transaction, so "not provisioned yet"
     * is only true at the moment it was read. Next.js renders a page's server
     * components in PARALLEL, so the first load of an unprovisioned tenant
     * fires several of these at once: all of them miss, all of them insert,
     * one wins and the rest fail on the slug's unique index. Reported from a
     * dashboard page doing exactly that.
     *
     * The advisory lock is keyed on the SOURCE id, so it serialises only the
     * racers for this tenant, and it is transaction-scoped so it releases on
     * commit with no unlock to forget.
     */
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"provision:" + sourceId}))`,
    );

    const [again] = (await tx.execute(sql`
      SELECT new_uuid FROM _migration_id_map
       WHERE collection = 'companies' AND old_object_id = ${sourceId}
    `)) as unknown as Array<{ new_uuid: string }>;
    if (again) {
      adopted = again.new_uuid;
      return;
    }

    // Scope FIRST. companies carries a WITH CHECK keyed on its own id, so the
    // tenant root has to be inserted inside its own scope — the same order the
    // backfill uses, and the reason it is not written through `db` directly.
    await tx.execute(
      sql`SELECT set_config('app.company_id', ${companyId}, true)`,
    );

    await tx.execute(sql`
      INSERT INTO companies (id, name, slug, base_currency)
      VALUES (
        ${companyId}, ${input.name},
        ${input.slug ?? sourceId},
        ${(input.baseCurrency ?? "KES").toUpperCase()}
      )
    `);

    await tx.execute(sql`
      INSERT INTO _migration_id_map (collection, old_object_id, new_uuid)
      VALUES ('companies', ${sourceId}, ${companyId})
      ON CONFLICT (collection, old_object_id) DO NOTHING
    `);

    /**
     * The rules the books obey, created with the company (0035).
     *
     * Defaults only — the caller's own settings are written by the company
     * form afterwards. A tenant with no settings row would have no VAT rate,
     * no thresholds and no document prefixes, and every read of them would
     * have to invent an answer.
     */
    await tx.execute(sql`
      INSERT INTO company_settings (company_id) VALUES (${companyId})
      ON CONFLICT (company_id) DO NOTHING
    `);

    /**
     * WHO CAN ENTER IT, DECIDED WHEN IT IS CREATED.
     *
     * A tenant with no grants is a tenant nobody can open. The lazy seeding in
     * tenant.ts only fires for a user who holds NO grant at all, so once a
     * SuperAdmin has been seeded, the next company created would have been
     * invisible to them — the switcher would not list it and the gate would
     * refuse it. Found by asking what happens on the second company.
     *
     * Every existing SuperAdmin, read from the grants themselves rather than
     * from Mongo: `granted_via = 'superadmin'` is this table's own record of
     * who platform staff are, and it is the same row a later audit reads.
     * Runs on the privileged connection, which is the only one that may look
     * across tenants — an application connection sees one company's grants and
     * that is the point.
     */
    await tx.execute(sql`
      INSERT INTO user_company_access (
        user_id, company_id, granted_via, granted_by_name
      )
      SELECT DISTINCT a.user_id, ${companyId}::uuid, 'superadmin', 'System'
        FROM user_company_access a
       WHERE a.granted_via = 'superadmin'
      ON CONFLICT (user_id, company_id) DO NOTHING
    `);

    if (input.ownerUserId) {
      await tx.execute(sql`
        INSERT INTO user_company_access (
          user_id, company_id, granted_via, granted_by_id, granted_by_name
        ) VALUES (
          ${String(input.ownerUserId)}, ${companyId},
          ${input.ownerRole === "SuperAdmin" ? "superadmin" : "primary"},
          ${String(input.ownerUserId)}, ${input.ownerName ?? "System"}
        )
        ON CONFLICT (user_id, company_id) DO UPDATE
          SET status = 'active', updated_at = now()
      `);
    }

    if (input.seedAccounts !== false) {
      await seedChartOfAccounts(tx as unknown as Tx, companyId);
    }
    if (input.initFiscalPeriods !== false) {
      await seedFiscalPeriods(
        tx as unknown as Tx,
        companyId,
        input.fiscalYearStart ?? new Date(),
      );
    }
  });

  if (adopted) return { companyId: adopted, created: false };
  return { companyId, created: true };
}

/**
 * Seeds the standard chart of accounts, resolving parents in a second pass.
 *
 * Two passes for the same reason accounts.parent_id needs them in the backfill:
 * the table is self-referential, and a child can be defined before its parent.
 *
 * A parent is demoted to `can_post = false` once it has a child. The Mongo
 * seeder does the same, and it is the rule that keeps a header account
 * structural — posting to "Current Assets" rather than to a real account under
 * it is how a chart of accounts stops meaning anything.
 */
async function seedChartOfAccounts(tx: Tx, companyId: string) {
  const definitions = getStandardChartOfAccounts();
  const idByCode = new Map<string, string>();

  for (const a of definitions) {
    const id = crypto.randomUUID();
    idByCode.set(a.accountCode, id);
    await tx.execute(sql`
      INSERT INTO accounts (
        id, company_id, account_code, account_name, account_type, sub_type,
        can_post, system_account, description, is_active, level
      ) VALUES (
        ${id}, ${companyId}, ${a.accountCode}, ${a.accountName},
        ${a.accountType}, ${a.subType ?? null},
        ${a.canPost !== false}, ${a.systemAccount ?? null},
        ${a.description ?? null}, true, 0
      )
    `);
  }

  /* Roots first: a child's path is built from its parent's. */
  await tx.execute(sql`
    UPDATE accounts SET path = account_code::ltree
     WHERE company_id = ${companyId} AND path IS NULL
  `);

  const parents = new Set<string>();
  for (const a of definitions) {
    if (!a.parentCode) continue;
    const parentId = idByCode.get(a.parentCode);
    const childId = idByCode.get(a.accountCode);
    if (!parentId || !childId) continue;

    parents.add(a.parentCode);
    /*
     * `path` as well as parent and level, which this pass did not set.
     * `accounts.path` is an ltree with a GiST index and `getDescendants()`
     * queries it with `<@` — against a NULL path that returns nothing, so
     * every company provisioned before this line had a chart the descendant
     * query could not walk. The seed is ordered parent-before-child, so the
     * parent's path is already materialised when the child reads it; the root
     * accounts are given theirs in the pass above.
     */
    await tx.execute(sql`
      UPDATE accounts c
         SET parent_id = ${parentId},
             level = COALESCE(p.level + 1, 1),
             path = COALESCE(p.path, ${a.parentCode}::ltree)
                    || ${a.accountCode}::ltree
        FROM accounts p
       WHERE c.id = ${childId} AND p.id = ${parentId}
    `);
  }

  for (const code of parents) {
    await tx.execute(sql`
      UPDATE accounts SET can_post = false
       WHERE id = ${idByCode.get(code)!} AND can_post = true
    `);
  }

  return definitions.length;
}

/**
 * Twelve monthly periods from the fiscal year start.
 *
 * Only the first is `open`; the rest are `future`. Opening all twelve would let
 * a posting land in a month nobody has reached yet, which is the control a
 * fiscal period exists to provide.
 */
async function seedFiscalPeriods(
  tx: Tx,
  companyId: string,
  fiscalYearStart: Date | string,
) {
  const start = new Date(fiscalYearStart);
  const year = start.getFullYear();

  for (let i = 0; i < 12; i++) {
    const periodStart = new Date(year, start.getMonth() + i, 1);
    // Day 0 of the next month is the last day of this one, leap years included.
    const periodEnd = new Date(year, start.getMonth() + i + 1, 0);
    const periodYear = periodStart.getFullYear();
    const periodMonth = periodStart.getMonth() + 1;
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    await tx.execute(sql`
      INSERT INTO fiscal_periods (
        company_id, period_code, period_name, year, month,
        start_date, end_date, status
      ) VALUES (
        ${companyId},
        ${`${periodYear}-${String(periodMonth).padStart(2, "0")}`},
        ${`${MONTHS[periodStart.getMonth()]} ${periodYear}`},
        ${periodYear}, ${periodMonth},
        ${iso(periodStart)}, ${iso(periodEnd)},
        ${i === 0 ? "open" : "future"}
      )
      ON CONFLICT DO NOTHING
    `);
  }

  return 12;
}

/**
 * Forgets a mapping whose company row is gone.
 *
 * Clearing the in-process cache is not enough: the stale row is in
 * `_migration_id_map`, so re-resolving finds it again and the request fails
 * the same way twice. Removing it lets the next resolve provision a fresh
 * tenant, which is what "the company is missing" should mean.
 *
 * Only ever called after reading `companies` and finding nothing.
 */
export async function forgetCompanyMapping(sourceCompanyId: string) {
  await privileged().execute(sql`
    DELETE FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${String(sourceCompanyId)}
       AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = new_uuid)
  `);
}

/**
 * The tenants this installation has, newest last.
 *
 * Read on the privileged connection because `companies` is under RLS keyed on
 * its own id (0024): a scoped connection sees exactly one, which is the point,
 * and something has to be able to ask "which are there" to offer a choice.
 */
export async function listProvisionedTenants() {
  const rows = (await privileged().execute(sql`
    SELECT m.old_object_id AS source_id, c.id, c.name, c.is_active
      FROM companies c
      JOIN _migration_id_map m
        ON m.new_uuid = c.id AND m.collection = 'companies'
     ORDER BY c.created_at
  `)) as unknown as Array<{
    source_id: string;
    id: string;
    name: string;
    is_active: boolean;
  }>;
  return rows;
}

/** Whether a tenant has been provisioned. Used by operator tooling, not the UI. */
export async function isCompanyProvisioned(sourceCompanyId: string) {
  const rows = (await privileged().execute(sql`
    SELECT 1 FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${String(sourceCompanyId)}
  `)) as unknown as Array<unknown>;
  return rows.length > 0;
}

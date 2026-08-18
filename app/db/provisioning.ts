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

function privileged() {
  if (_db) return _db;

  // Falls back to DATABASE_URL so a single-database local setup still works.
  // Where they differ, DIRECT_DATABASE_URL is the unpooled owner connection:
  // provisioning runs DDL-adjacent work in one long transaction, which
  // transaction-mode pooling would break.
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL is not set — see .env.example");

  _client = postgres(url, { max: 2, prepare: false });
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
  const sourceId = String(input.sourceCompanyId);

  const existing = (await db.execute(sql`
    SELECT new_uuid FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${sourceId}
  `)) as unknown as Array<{ new_uuid: string }>;

  if (existing.length) {
    return { companyId: existing[0].new_uuid, created: false };
  }

  const companyId = crypto.randomUUID();

  await db.transaction(async (tx) => {
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

  const parents = new Set<string>();
  for (const a of definitions) {
    if (!a.parentCode) continue;
    const parentId = idByCode.get(a.parentCode);
    const childId = idByCode.get(a.accountCode);
    if (!parentId || !childId) continue;

    parents.add(a.parentCode);
    await tx.execute(sql`
      UPDATE accounts
         SET parent_id = ${parentId},
             level = COALESCE(
               (SELECT level + 1 FROM accounts WHERE id = ${parentId}), 1)
       WHERE id = ${childId}
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

/** Whether a tenant has been provisioned. Used by operator tooling, not the UI. */
export async function isCompanyProvisioned(sourceCompanyId: string) {
  const rows = (await privileged().execute(sql`
    SELECT 1 FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${String(sourceCompanyId)}
  `)) as unknown as Array<unknown>;
  return rows.length > 0;
}

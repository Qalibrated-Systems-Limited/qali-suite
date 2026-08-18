import { sql } from "drizzle-orm";
import { privilegedDb } from "./provisioning";
import { forgetCompanyActive } from "./tenant";

/**
 * Company lifecycle on the Postgres side.
 *
 * A tenant exists in two stores while the migration runs, and the operations
 * that change a company as a WHOLE — rename it, deactivate it, reset its books
 * — have to reach both or the two drift. Provisioning covered creation; this
 * covers the rest of the lifecycle.
 *
 * Runs on the privileged connection for the same reason provisioning does:
 * since 0024 `companies` is under RLS keyed on its own id, so the row can only
 * be reached from inside its own scope, and a reset spans every tenant table.
 */

/** The tenant's Postgres uuid, or null if it was never provisioned. */
async function companyUuidFor(sourceCompanyId: string) {
  const rows = (await privilegedDb().execute(sql`
    SELECT new_uuid FROM _migration_id_map
     WHERE collection = 'companies' AND old_object_id = ${String(sourceCompanyId)}
  `)) as unknown as Array<{ new_uuid: string }>;
  return rows.length ? rows[0].new_uuid : null;
}

/**
 * Keeps the Postgres tenant row in step with the company record.
 *
 * Only the fields Postgres actually behaves on. Branding, subscription, M-Pesa
 * tills and the rest stay where they are — `companies` here is a tenant root,
 * not a copy of the company document, and mirroring fields nothing reads would
 * only create more to drift.
 *
 * A no-op for a company that was never provisioned: it will pick these up when
 * it is, from the same source.
 */
export async function syncCompanyRecord(
  sourceCompanyId: string,
  changes: { name?: string | null; slug?: string | null; baseCurrency?: string | null },
) {
  const companyId = await companyUuidFor(sourceCompanyId);
  if (!companyId) return { synced: false as const };

  await privilegedDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
    await tx.execute(sql`
      UPDATE companies
         SET name          = COALESCE(${changes.name ?? null}, name),
             slug          = COALESCE(${changes.slug ?? null}, slug),
             base_currency = COALESCE(${changes.baseCurrency?.toUpperCase() ?? null}, base_currency),
             updated_at    = now()
       WHERE id = ${companyId}
    `);
  });

  return { synced: true as const, companyId };
}

/**
 * Activates or deactivates the tenant.
 *
 * `is_active` is not decorative: withAuthorizedTenant refuses a deactivated
 * tenant, so deactivating a company here actually stops its books being read
 * or written rather than only greying it out in an admin list.
 */
export async function setCompanyActive(sourceCompanyId: string, isActive: boolean) {
  const companyId = await companyUuidFor(sourceCompanyId);
  if (!companyId) return { synced: false as const };

  await privilegedDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
    await tx.execute(sql`
      UPDATE companies SET is_active = ${isActive}, updated_at = now()
       WHERE id = ${companyId}
    `);
  });

  forgetCompanyActive(companyId);
  return { synced: true as const, companyId };
}

/**
 * Master data that survives a reset — the Postgres half of
 * RESET_KEEP_COLLECTIONS in lib/company-reset.js, and it has to agree with it.
 * A table kept on one side and wiped on the other leaves the two stores
 * describing different businesses.
 */
const KEEP = new Set([
  "companies",
  "accounts", // chart of accounts; balances are derived, so nothing to zero
  "fiscal_periods",
  "parties", // wiped only with wipeParties
  "products", // catalogue kept, quantities zeroed
]);

/**
 * Back-references that make the delete order a cycle rather than an order.
 *
 * The same three the backfill's ORDER note records, pointing the other way:
 * stock_requests -> invoices -> item_checkouts -> stock_requests, and
 * bill_lines -> weighbridge_tickets -> bills. Nulled first so what remains is
 * a DAG the pass below can drain.
 */
const CYCLE_EDGES: Array<[string, string[]]> = [
  ["stock_requests", ["draft_invoice_id"]],
  ["item_checkouts", ["sale_invoice_id", "failed_invoice_id"]],
  ["weighbridge_tickets", ["invoice_id", "bill_id", "linked_ticket_id"]],
];

export interface ResetOptions {
  /** Count only. Nothing is deleted. */
  dryRun?: boolean;
  /** Also wipe customers, suppliers and employees. */
  wipeParties?: boolean;
}

/**
 * Deletes a tenant's transactional data, keeping its master data.
 *
 * DISCOVERY-DRIVEN, like the Mongo engine it mirrors: the tables come from
 * information_schema rather than a hand-written list, so a table added by a
 * later slice is covered without anyone remembering to add it here. That was
 * the lesson of the hand-listed script this replaces on the other side.
 *
 * ORDERING IS DRAINED, NOT DECLARED. After the cycle edges are nulled, each
 * pass attempts every remaining table inside a savepoint and defers the ones
 * whose children have not gone yet. It repeats until a pass makes no progress.
 * If tables remain at that point it RAISES with their names — a new cycle
 * surfaces loudly rather than silently leaving a tenant's data behind on an
 * operation whose whole promise is that it is gone.
 *
 * NEVER TRUNCATE. It ignores row-level security entirely (§9A.1), so it would
 * be a cross-tenant delete rather than a reset. Every statement here is
 * scoped by company_id and runs inside the tenant's own RLS scope, so a policy
 * bug fails closed instead of reaching another tenant's books.
 */
export async function resetCompanyBooks(
  sourceCompanyId: string,
  opts: ResetOptions = {},
) {
  const { dryRun = false, wipeParties = false } = opts;
  const companyId = await companyUuidFor(sourceCompanyId);
  if (!companyId) return { synced: false as const, summary: {}, totalDeleted: 0 };

  const keep = new Set(KEEP);
  if (wipeParties) keep.delete("parties");

  const db = privilegedDb();
  const summary: Record<string, number> = {};

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);

    const discovered = (await tx.execute(sql`
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public'
         AND c.column_name = 'company_id'
         AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name
    `)) as unknown as Array<{ table_name: string }>;

    let pending = discovered
      .map((r) => r.table_name)
      .filter((name) => !keep.has(name));

    if (dryRun) {
      for (const name of pending) {
        const [row] = (await tx.execute(
          sql`SELECT count(*)::int AS n FROM ${sql.identifier(name)} WHERE company_id = ${companyId}`,
        )) as unknown as Array<{ n: number }>;
        if (row.n) summary[name] = row.n;
      }
      // Nothing was written, but the transaction is rolled back regardless so
      // a dry run cannot leave a scoped connection in a surprising state.
      throw new DryRun();
    }

    for (const [table, columns] of CYCLE_EDGES) {
      if (keep.has(table) || !pending.includes(table)) continue;
      for (const column of columns) {
        await tx.execute(sql`
          UPDATE ${sql.identifier(table)}
             SET ${sql.identifier(column)} = NULL
           WHERE company_id = ${companyId}
             AND ${sql.identifier(column)} IS NOT NULL
        `);
      }
    }

    while (pending.length) {
      const deferred: string[] = [];
      let progressed = false;

      for (const name of pending) {
        try {
          const deleted = (await tx.transaction(async (sp) => {
            const rows = (await sp.execute(sql`
              DELETE FROM ${sql.identifier(name)} WHERE company_id = ${companyId}
              RETURNING 1
            `)) as unknown as Array<unknown>;
            return rows.length;
          })) as number;

          if (deleted) summary[name] = (summary[name] ?? 0) + deleted;
          progressed = true;
        } catch {
          // A child still holds a reference. Try again once it has gone.
          deferred.push(name);
        }
      }

      if (!progressed) {
        throw new Error(
          "Reset could not drain these tables — a reference cycle is not covered " +
            `by CYCLE_EDGES: ${deferred.join(", ")}`,
        );
      }
      pending = deferred;
    }

    // Quantities are stored on products, not derived, so they are zeroed the
    // way the Mongo engine zeroes them. Account balances need no equivalent:
    // they are a view over journal_lines, which have just gone (§4.4).
    await tx.execute(sql`
      UPDATE products
         SET quantity_on_hand = 0, quantity_committed = 0, quantity_on_hold = 0,
             updated_at = now()
       WHERE company_id = ${companyId}
    `);
  }).catch((err) => {
    if (err instanceof DryRun) return;
    throw err;
  });

  const totalDeleted = Object.values(summary).reduce((a, b) => a + b, 0);
  return { synced: true as const, companyId, summary, totalDeleted };
}

/** Rolls a dry run back without reporting it as a failure. */
class DryRun extends Error {}

/**
 * Applies app/db/migrations/*.sql in journal order.
 *
 * Run with `npm run db:migrate`. Uses a dedicated single connection (max: 1)
 * rather than the app pool — migrations take locks and must not interleave.
 *
 * CONNECTION: prefers DIRECT_DATABASE_URL, falls back to DATABASE_URL.
 *
 * Two reasons the migration connection is not the application's:
 *
 * 1. Pooling. The app runs through PgBouncer / Neon's pooled endpoint in
 *    transaction mode (§7). The migrator takes an advisory lock and runs DDL
 *    in long transactions, and neither survives a pooler that hands the
 *    connection to someone else between statements. Migrations want the direct
 *    endpoint.
 *
 * 2. Row-level security. Migrations that touch tenant DATA rather than schema —
 *    0017's amount_paid reconciliation is the live example — scan across
 *    companies with no app.company_id set. Under RLS that returns zero rows, so
 *    the reconciliation would silently find nothing and report success. It
 *    works because this connection is the owner/superuser, which bypasses RLS.
 *    The application connection must be the opposite: a role WITHOUT
 *    BYPASSRLS, or every policy in the schema is inert. See migration 0023.
 *
 * Locally these are the same database and DIRECT_DATABASE_URL can stay unset.
 *
 * ── WHY THIS DOES NOT USE drizzle-orm's `migrate()` ──────────────────────────
 *
 * That helper wraps the ENTIRE set of pending migrations in ONE transaction.
 * That is wrong for a from-scratch apply of this history, because Postgres
 * forbids USING a new enum value in the same transaction that ADDED it
 * ("unsafe use of new value ... of enum type"). Several migrations add an enum
 * value that a LATER migration then references as a literal — 0030 adds
 * `future` to fiscal_period_status and 0106 sets rows to it; the stock-request
 * and certificate source-document values do the same. Applied incrementally,
 * each deploy is its own transaction, so the ADD has committed before the USE.
 * Collapsed into one transaction by `migrate()`, the whole run dies on 0106 and
 * rolls back everything — a fresh database (CI, a new environment) can never be
 * migrated at all.
 *
 * So this applies EACH migration in its OWN transaction, committing between —
 * the granularity these migrations were authored for. It keeps drizzle's exact
 * bookkeeping (the `drizzle.__drizzle_migrations` table, the same content hash
 * and `created_at` = the journal's `when`), so it is a drop-in: a database
 * migrated by the old helper is picked up mid-history without re-running, and a
 * later `drizzle-kit`/`migrate()` run recognises everything this applied.
 */
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error(
    "Neither DIRECT_DATABASE_URL nor DATABASE_URL is set — see .env.example",
  );
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);

// The same migrations table drizzle-orm/postgres-js uses, so the two runners
// share bookkeeping. `created_at` holds the journal `when` (folderMillis).
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

try {
  console.log("Applying migrations from app/db/migrations …");

  const migrations = readMigrationFiles({
    migrationsFolder: "./app/db/migrations",
  });

  await db.execute(
    drizzleSql.raw(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`),
  );
  await db.execute(
    drizzleSql.raw(
      `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )`,
    ),
  );

  // Serialise concurrent migrators, exactly as drizzle's own migrate() does.
  await db.execute(drizzleSql`SELECT pg_advisory_lock(hashtext('drizzle_migrations'))`);

  try {
    const rows = await db.execute(
      drizzleSql.raw(
        `SELECT id, hash, created_at FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`,
      ),
    );
    const last = rows[0];
    const lastAt = last ? Number(last.created_at) : undefined;

    let applied = 0;
    for (const migration of migrations) {
      if (lastAt !== undefined && migration.folderMillis <= lastAt) continue;

      // EACH MIGRATION IN ITS OWN TRANSACTION — the whole point of this runner.
      await db.transaction(async (tx) => {
        for (const stmt of migration.sql) {
          await tx.execute(drizzleSql.raw(stmt));
        }
        await tx.execute(
          drizzleSql`INSERT INTO ${drizzleSql.identifier(MIGRATIONS_SCHEMA)}.${drizzleSql.identifier(
            MIGRATIONS_TABLE,
          )} ("hash", "created_at") VALUES (${migration.hash}, ${migration.folderMillis})`,
        );
      });
      applied += 1;
    }

    console.log(
      applied
        ? `✓ Migrations applied (${applied} new)`
        : "✓ Migrations applied (already up to date)",
    );
  } finally {
    await db.execute(
      drizzleSql`SELECT pg_advisory_unlock(hashtext('drizzle_migrations'))`,
    );
  }
} catch (err) {
  console.error("✗ Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

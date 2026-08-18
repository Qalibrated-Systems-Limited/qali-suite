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
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error(
    "Neither DIRECT_DATABASE_URL nor DATABASE_URL is set — see .env.example",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  console.log("Applying migrations from app/db/migrations …");
  await migrate(drizzle(sql), { migrationsFolder: "./app/db/migrations" });
  console.log("✓ Migrations applied");
} catch (err) {
  console.error("✗ Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

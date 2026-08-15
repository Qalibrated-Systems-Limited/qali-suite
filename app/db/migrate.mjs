/**
 * Applies app/db/migrations/*.sql in journal order.
 *
 * Run with `npm run db:migrate`. Uses a dedicated single connection (max: 1)
 * rather than the app pool — migrations take locks and must not interleave.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — see .env.example");
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

import { sql } from "drizzle-orm";

// ============================================
// GET /api/health — readiness probe
// ============================================
// For load balancers / uptime monitors / PM2 health checks. Verifies the
// process is up AND the database answers — a zombie process with a dead
// connection reports unhealthy instead of serving 500s.
// Unauthenticated by design; returns no internals beyond up/down.
//
// IT PINGED MONGO, AND ONLY MONGO. Postgres is the application's database:
// auth, the ledger, every module. So on a deployment without a Mongo
// connection this returned `{ ok: false, db: "down" }` with a 503 — for ever,
// on an app that was working — and every load balancer in front of it would
// have taken the instance out of rotation.
//
// Postgres is what `ok` means, and since 0102 it is the only store there is.

export async function GET() {
  const health = { ok: false, db: "down" };

  try {
    const { privilegedDb } = await import("@/app/db/provisioning");
    await privilegedDb().execute(sql`SELECT 1`);
    health.ok = true;
    health.db = "up";
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }

  /*
   * THE MONGO PROBE IS GONE — 0102.
   *
   * It reported a legacy store alongside Postgres while modules were still
   * being ported. Nothing in the application opens a Mongo connection any
   * more — `app/config/dbConnect.js` and `app/models/` are deleted — so the
   * probe could only ever have reported on a database this app does not use.
   */

  return Response.json(health);
}

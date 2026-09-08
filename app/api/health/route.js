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
// auth, the ledger, every ported module. So on a deployment without a Mongo
// connection this returned `{ ok: false, db: "down" }` with a 503 — for ever,
// on an app that was working — and every load balancer in front of it would
// have taken the instance out of rotation.
//
// Postgres is what `ok` now means. Mongo is reported ALONGSIDE it and only
// when MONGODB_URI is configured, because a deployment that has deliberately
// left it out is not unhealthy for having done so.

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

  if (process.env.MONGODB_URI) {
    try {
      const dbConnect = (await import("@/app/config/dbConnect")).default;
      const mongoose = (await import("mongoose")).default;
      await dbConnect();
      await mongoose.connection.db.admin().ping();
      health.mongo = "up";
    } catch {
      /*
       * NOT a 503. The modules still on Mongo are integrations and two
       * settings screens; the ledger, auth and every money path are Postgres.
       * Taking the whole instance out of rotation because a legacy store is
       * unreachable would be a bigger outage than the one being reported.
       */
      health.mongo = "down";
    }
  }

  return Response.json(health);
}

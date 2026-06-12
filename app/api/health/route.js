import dbConnect from "@/app/config/dbConnect";
import mongoose from "mongoose";

// ============================================
// GET /api/health — readiness probe
// ============================================
// For load balancers / uptime monitors / PM2 health checks. Verifies the
// process is up AND the database answers a ping — a zombie process with a
// dead DB connection reports unhealthy instead of serving 500s.
// Unauthenticated by design; returns no internals beyond up/down.

export async function GET() {
  try {
    await dbConnect();
    await mongoose.connection.db.admin().ping();
    return Response.json({ ok: true, db: "up" });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}

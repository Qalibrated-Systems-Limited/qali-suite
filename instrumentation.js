// Runs ONCE at server boot (Next.js instrumentation hook).
// Fail fast on missing critical env instead of surfacing as runtime
// errors hours later; warn on optional integrations so the gap is
// visible in the boot log.
export async function register() {
  /**
   * `DATABASE_URL`, not `MONGODB_URI` — 0102.
   *
   * This listed MONGODB_URI as required and threw "refusing to start" without
   * it. That was correct while Mongo held the data; after the port it was a
   * boot-time refusal to run on the only configuration that works — a
   * Postgres-only deployment would not start, and the error named a database
   * the application no longer opens a connection to.
   */
  const required = ["DATABASE_URL", "AUTH_SECRET"];
  const optional = ["RESEND_API_KEY", "FROM_EMAIL", "APP_URL", "CRON_SECRET"];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")} — refusing to start.`,
    );
  }

  const absent = optional.filter((k) => !process.env[k]);
  if (absent.length > 0) {
    console.warn(
      `[boot] optional env not set: ${absent.join(", ")} — email notifications and/or cron auth will be disabled.`,
    );
  }

  /**
   * A loud warning, not a refusal.
   *
   * `withoutTenantScope()` is blocked in production unless this is set, so a
   * box that has it set has disabled that guard for every request — see
   * app/db/client.ts. It exists for maintenance scripts and should never be
   * present in a running server's environment.
   */
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_UNSCOPED_DB) {
    console.warn(
      "[boot] ALLOW_UNSCOPED_DB is set in production — unscoped, RLS-bypassing " +
        "database access is permitted. Unset it unless a maintenance script needs it.",
    );
  }

  console.log("[boot] environment validated");
}

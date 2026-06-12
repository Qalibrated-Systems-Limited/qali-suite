// Runs ONCE at server boot (Next.js instrumentation hook).
// Fail fast on missing critical env instead of surfacing as runtime
// errors hours later; warn on optional integrations so the gap is
// visible in the boot log.
export async function register() {
  const required = ["MONGODB_URI", "AUTH_SECRET"];
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
  console.log("[boot] environment validated");
}

import { auth } from "@/auth";
import dbConnect from "@/app/config/dbConnect";
import User from "@/app/models/user";

/**
 * Verify the caller's JWT still represents their current privileges.
 *
 * The JWT carries `tokenVersion` from when it was issued. Privileged
 * admin actions (role change, deactivate, password reset, tenant move)
 * increment the User document's `tokenVersion`. If the two diverge,
 * the session is stale and must be rejected — the user has to
 * re-authenticate to pick up the new privileges.
 *
 * User-facing messages are deliberately generic — we never say
 * "deactivated" / "your account no longer exists" / "privileges
 * changed". A would-be attacker probing session state shouldn't learn
 * anything from the response. The internal `reason` field is kept for
 * server-side logging / debugging.
 *
 * Failure reasons (internal only):
 *   - no session                    → STALE_NO_SESSION
 *   - user no longer exists         → STALE_USER_GONE
 *   - user has been deactivated     → STALE_DEACTIVATED
 *   - tokenVersion mismatch         → STALE_VERSION
 *
 * Backwards-compat: tokens issued before the tokenVersion rollout
 * have no `tokenVersion` in the JWT (undefined). We treat those as
 * fresh — they'll expire on their own within session.maxAge (8h).
 *
 * Perf: one indexed `findById` projection (`status tokenVersion`),
 * lean — sub-ms on Atlas. Call from privileged server actions only;
 * read-mostly pages don't need this.
 *
 * @returns {Promise<{ ok: true, session: any, user: any }
 *                  | { ok: false, reason: string, message: string }>}
 */

// One user-facing message, regardless of which check failed. The
// caller still gets `reason` for logs.
const GENERIC_RESIGNIN = "Please sign in again to continue.";

export async function requireFreshSession() {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      reason: "STALE_NO_SESSION",
      message: GENERIC_RESIGNIN,
    };
  }

  await dbConnect();
  const dbUser = await User.findById(session.user.id)
    .select("status tokenVersion")
    .lean();

  if (!dbUser) {
    return {
      ok: false,
      reason: "STALE_USER_GONE",
      message: GENERIC_RESIGNIN,
    };
  }

  if (dbUser.status === "Inactive") {
    return {
      ok: false,
      reason: "STALE_DEACTIVATED",
      message: GENERIC_RESIGNIN,
    };
  }

  // Pre-rollout tokens lack `tokenVersion` — treat as fresh; they'll
  // age out via session.maxAge.
  const tokenV = session.user.tokenVersion;
  const dbV = dbUser.tokenVersion ?? 0;
  if (typeof tokenV === "number" && tokenV !== dbV) {
    return {
      ok: false,
      reason: "STALE_VERSION",
      message: GENERIC_RESIGNIN,
    };
  }

  return { ok: true, session, user: session.user };
}

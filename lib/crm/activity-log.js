import "server-only";
import Activity from "@/app/models/activity";

// Shared, session-aware activity writer. Plain async helper (NOT a server
// action) so lead/opportunity actions can append to the timeline inside the
// same transaction as the change that triggered it. Best-effort by design
// at the call site — a failed log should never roll back real work unless
// the caller explicitly threads a session and wants it atomic.
export async function recordActivity(data, session = null) {
  const [doc] = await Activity.create(
    [data],
    session ? { session } : undefined,
  );
  return doc;
}

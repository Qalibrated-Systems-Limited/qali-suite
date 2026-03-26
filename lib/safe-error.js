/**
 * Sanitize error messages before returning to clients.
 * Only passes through messages with known-safe prefixes.
 * Everything else is suppressed (logged server-side) and replaced with a generic message.
 */
const SAFE_PREFIXES = [
  // Auth & access
  "Unauthorized", "Please sign in", "You do not have", "Only SuperAdmin",
  "Not authorized", "Access denied",
  // Plan gating
  "This feature requires", "User limit reached", "Your free trial",
  "Your subscription", "Plan upgrade required", "Upgrade to",
  // Validation
  "Invalid ", "Required:", "Missing ", "Must provide", "Must specify",
  "At least ", "Maximum ", "Minimum ", "Too many ",
  "Duplicate ", "already exists",
  // Business logic
  "Cannot delete", "Cannot update", "Cannot create", "Cannot approve",
  "Cannot cancel", "Cannot void", "Cannot close", "Cannot modify",
  "Email already", "Password must", "Invite has",
  "Draft only", "Approved payroll", "This company",
  "No employee", "No payroll", "No budget", "No leave",
  "Not found", "does not exist",
];

export function safeErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  const msg = error instanceof Error ? error.message : String(error || "");

  // Check if message starts with any known-safe prefix (case-insensitive start)
  const lowerMsg = msg.toLowerCase();
  if (SAFE_PREFIXES.some(prefix => lowerMsg.startsWith(prefix.toLowerCase()))) {
    return msg;
  }

  // Log the real error server-side for debugging
  console.error("[Suppressed error detail]:", msg);
  return fallback;
}

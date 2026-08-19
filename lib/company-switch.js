import { withUserScope } from "@/app/db/client";
import { listAllowedCompanies } from "@/app/db/repositories/companyAccess";

/**
 * Whether this user may operate in this company.
 *
 * Read through the grants, under the user's own scope — the same rows and the
 * same policy the request gate uses, so a switch cannot be accepted on terms
 * the gate would then refuse.
 *
 * Plain JS with no "server-only": auth.ts imports it from the JWT callback.
 */
export async function assertUserMayEnterCompany(userId, companyId) {
  if (!userId || !companyId) return false;
  const allowed = await withUserScope(userId, (tx) =>
    listAllowedCompanies(tx, userId),
  );
  return allowed.some((c) => c.id === String(companyId) && c.isActive);
}
